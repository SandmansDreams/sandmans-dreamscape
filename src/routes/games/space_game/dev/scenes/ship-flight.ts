import { buildShip, findShip, SHIPS } from "../../assets/ships"
import { Ship } from "../../game/ship"
import {
    bodyAt, bounce, boundingRadius, shipPhysics, step, throttles,
    type Arena, type Body, type Controls, type ShipPhysics,
} from "../../game/physics"
import { Camera, type Vec2 } from "../../render/camera"
import { Color } from "../../render/color"
import type { Frame } from "../../render/frame"
import { appendEmissiveBloom, appendLayer } from "../../render/grid/blockDraw"
import { DynamicMesh, Mesh, MeshBuilder } from "../../render/mesh"
import { InstanceBatch } from "../../render/webgpu/instance"
import { fadeOf, ParticleField } from "../../game/particles"
import { LightBinding } from "../../render/lighting"
import { glowDisc } from "../../render/glow"
import { DEFAULT_SHADING, Light, LightField } from "../../game/lighting"
import { InputService } from "../../input/service"
import type { SceneContext, SceneInstance } from "../../render/scene"
import type { ActionsOf, SearchColumn, SettingsSchema, ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"

/** World units per cell, matching the builder so a ship is the size you drew it. */
const CELL = 32

const WALL_COLOR = Color.from("#3d6b8c")

/** The opposite push, which is the way the exhaust actually leaves. */
function negated(vector: Vec2): Vec2 {
    return { x: -vector.x, y: -vector.y }
}

/*~~~ Exhaust ~~~*/

/**
 * How many specks a full-throttle engine makes per second.
 *
 * Per engine rather than per ship, so a nine-engine burn looks like nine engines.
 */
const EXHAUST_RATE = 90

/** The most specks in the air at once, shared by every engine on the ship. */
const EXHAUST_CAPACITY = 2400

/** Cells per second, before jitter. Fast enough to leave the ship behind. */
const EXHAUST_SPEED = 14

const EXHAUST_LIFE = 0.45
const EXHAUST_SIZE = 0.22
const EXHAUST_COLOR = Color.from("#ffb347")

/**
 * An engine's own glow: short-reaching, since it is a nozzle and not a sun.
 *
 * Deliberately restrained. A nozzle at full brightness drowned the hull it was
 * mounted on and read as an explosion rather than a burn, so the drawn blob is
 * well under half the size and brightness it started at. The exhaust plume is
 * what should carry the eye; this is the heat behind it.
 */
const GLOW_RANGE = 220
const GLOW_RADIUS = 26
const GLOW_INTENSITY = 0.35

const SHIP_COLUMNS: readonly SearchColumn[] = [
    { header: "Ship", cell: (id) => findShip(id)?.name ?? id },
    { header: "Creator", cell: (id) => findShip(id)?.creator ?? "" },
]

const SETTINGS = {
    ship: {
        type: "search",
        label: "Ship",
        default: SHIPS[0]?.id ?? "",
        options: SHIPS.map((ship) => ship.id),
        placeholder: "Find a ship...",
        columns: SHIP_COLUMNS,
        limit: 50,
    },

    arenaSep: { type: "separator", label: "Arena" },

    width:      { type: "range", label: "Width", default: 80, min: 20, max: 200, step: 5 },
    height:     { type: "range", label: "Height", default: 50, min: 20, max: 200, step: 5 },
    bounciness: { type: "range", label: "Bounciness", default: 0.5, min: 0, max: 1, step: 0.05 },

    flightSep: { type: "separator", label: "Flight" },

    assist:  { type: "checkbox", label: "Flight assist", default: true },
    exhaust: { type: "checkbox", label: "Exhaust", default: true },

    lightSeparator: { type: "separator", label: "Lighting" },

    lit:            { type: "checkbox", label: "Lit", default: true },
    lightAngle:     { type: "range", label: "Angle", default: 210, min: 0, max: 360, step: 5 },
    lightDistance:  { type: "range", label: "Distance", default: 900, min: 100, max: 4000, step: 50 },
    lightIntensity: { type: "range", label: "Intensity", default: 1.2, min: 0, max: 3, step: 0.05 },
    lightRange:     { type: "range", label: "Falloff", default: 1600, min: 200, max: 8000, step: 100 },
    lightColor:     { type: "color", label: "Light Color", default: "#fff3d6" },
    reset:  { type: "button", label: "Reset Ship" },
} as const satisfies SettingsSchema

type FlightValues = ValuesOf<typeof SETTINGS>

/** What the flight readout shows. Published, so the panel owns none of it. */
export interface FlightInfo {
    name: string
    mass: number
    inertia: number
    /** How many engines the ship has, and how many are burning right now. */
    thrusters: number
    firing: number
    speed: number
    /** Radians per second. Signed, so the direction is in the number. */
    spin: number
    /** True while the ship is against a wall. */
    touching: boolean
    assist: boolean
}

class ShipFlight implements SceneInstance<FlightValues> {
    private readonly context: SceneContext
    private readonly input: InputService
    private readonly camera = new Camera()

    private ship: Ship
    /** The last values update() saw, so render() knows which pipeline to use. */
    private settings: FlightValues | null = null
    private physics: ShipPhysics
    private radius = 0
    private body: Body = bodyAt(0, 0)

    /**
     * The ship about its own center of mass, built once per ship.
     *
     * Static now: an instance carries where it is and which way it is pointing,
     * so the vertices never move. The CPU pass that used to rewrite every
     * position each frame is gone with it.
     */
    private shipMesh: Mesh | null = null
    /** The halo around cells that light themselves, laid over the finished hull. */
    private bloomMesh: Mesh | null = null
    /** Distance to the outermost cell, which is what the shading fades across. */
    private shadingReach = 1
    private readonly shipBatch: InstanceBatch
    private readonly lights: LightBinding
    private readonly walls: DynamicMesh

    /*~~~ Lighting ~~~*/
    private readonly field = new LightField()
    private readonly sun = new Light({ position: { x: 0, y: 0 } })
    /** One per thruster, lit by how hard it is burning. Mounted, so self-excluded. */
    private engineGlows: Light[] = []
    private readonly glowBatch: InstanceBatch
    private readonly glowMesh: Mesh

    /*~~~ Exhaust ~~~*/
    private readonly exhaust = new ParticleField(EXHAUST_CAPACITY)
    private readonly exhaustBatch: InstanceBatch
    /** One quad, repeated once per speck. Built once and never touched again. */
    private readonly spark: Mesh
    /**
     * The fraction of a particle each engine is owed, carried between frames.
     *
     * Without it, an engine making 1.5 specks a frame would make one - the half
     * dropped every frame, so the rate would silently depend on the frame rate.
     * One entry per thruster, rebuilt with the ship.
     */
    private exhaustOwed: number[] = []

    private builtShip = ""
    private wallsKey = ""
    private firing = 0
    private touching = false

    private assist = true
    /** The checkbox as it was last seen, so a click on it beats the key. */
    private assistSetting: boolean | null = null

    readonly actions: Record<ActionsOf<typeof SETTINGS>, () => void> = {
        reset: () => this.resetBody(),
    }

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        this.input = context.input
        this.walls = DynamicMesh.create(gpu, "arena")

        this.shipBatch = InstanceBatch.create(gpu, context.renderer.instanceLayout, 4, "flight ship")
        this.glowBatch = InstanceBatch.create(gpu, context.renderer.instanceLayout, 32, "flight glow")
        this.lights = LightBinding.create(gpu, 4)
        this.glowMesh = glowDisc().build(gpu, "glow disc")

        this.field.add(this.sun)

        // Centered, so an instance's rotate-and-scale works about the speck's
        // middle rather than dragging it off its own position
        this.spark = new MeshBuilder()
            .quad(-0.5, -0.5, 1, 1, Color.WHITE)
            .build(gpu, "spark")

        this.exhaustBatch = InstanceBatch.create(
            gpu, context.renderer.instanceLayout, EXHAUST_CAPACITY, "exhaust",
        )

        // A real ship arrives on the first update; this keeps every field valid
        // until then rather than leaving them undefined
        this.ship = new Ship("empty", "Empty")
        this.physics = shipPhysics(this.ship)
    }

    update(dt: number, settings: FlightValues): void {
        this.settings = settings
        this.syncShip(settings)
        this.buildWalls(settings)
        this.fitCamera(settings)
        this.syncAssist(settings)

        const controls = this.readControls()
        const before = this.body

        // dt arrives already clamped by the frame loop, which caps a backgrounded
        // tab's catch-up for exactly this reason. Clamping again here only made the
        // simulation run slower than real time whenever frames were scarce.
        this.body = step(this.body, this.physics, controls, dt)
        const flown = this.body
        this.body = bounce(this.body, this.radius, this.arenaOf(settings), settings.bounciness)

        // A bounce is the only thing that changes velocity here, so comparing the
        // two is cheaper and more honest than re-deriving which wall was hit
        this.touching = this.body.velocity.x !== flown.velocity.x
            || this.body.velocity.y !== flown.velocity.y

        const firing = throttles(this.physics, controls, before.spin, dt)
        this.firing = firing.filter((throttle) => throttle > 0).length

        this.updateExhaust(firing, dt, settings)
        this.syncLights(settings, firing)
        this.publishInfo()
    }

    /**
     * Z flips assist; the checkbox still wins whenever it changes.
     *
     * The scene owns the live value because settings only flow inward - a key
     * press has nowhere to write one back to. Comparing against the value last
     * seen, rather than reading the setting every frame, is what lets the key
     * hold a state the checkbox disagrees with until the checkbox moves again.
     */
    private syncAssist(settings: FlightValues): void {
        if (settings.assist !== this.assistSetting) {
            this.assistSetting = settings.assist
            this.assist = settings.assist
        }

        if (this.input.pressed("flight.toggleAssist")) this.assist = !this.assist
    }

    /**
     * W and S burn along the ship's own axis, A and D sideways, Q and E turn.
     *
     * Q and E spend only the thrusters marked for steering in the builder; W, A,
     * S and D fire whatever points the right way, spin and all.
     */
    private readControls(): Controls {
        return {
            // The ship's north is negative y, and axis() already returns -1 for the
            // first key, so W needs no sign correction here
            move: {
                x: this.input.axis("flight.strafeLeft", "flight.strafeRight"),
                y: this.input.axis("flight.thrustForward", "flight.thrustBack"),
            },
            turn: this.input.axis("flight.turnLeft", "flight.turnRight"),
            assist: this.assist,
        }
    }

    private arenaOf(settings: FlightValues): Arena {
        return {
            minX: -settings.width / 2,
            maxX: settings.width / 2,
            minY: -settings.height / 2,
            maxY: settings.height / 2,
        }
    }

    private resetBody(): void {
        this.body = bodyAt(0, 0)
    }

    /*~~~ Ship ~~~*/

    private syncShip(settings: FlightValues): void {
        if (settings.ship === this.builtShip) return
        this.builtShip = settings.ship

        this.exhaust.clear()
        this.exhaustOwed = []

        this.ship = buildShip(settings.ship)
        this.physics = shipPhysics(this.ship)
        this.radius = boundingRadius(this.ship)
        this.resetBody()

        // Origin at the center of mass, so the rotation in uploadShip turns the
        // ship about the point the physics actually spins it around
        const builder = new MeshBuilder()
        for (const grid of this.ship.layersOf()) {
            appendLayer(builder, grid, CELL, this.ship.centerOfMass)
        }

        this.shadingReach = Math.max(builder.cellReach, 1)

        this.shipMesh?.destroy()
        this.shipMesh = builder.vertexCount > 0
            ? builder.build(this.context.gpu, "ship")
            : null

        // Its own mesh rather than more triangles in the ship's: it is drawn
        // through a different pipeline, over the top, and must never be shaded
        const bloom = new MeshBuilder()
        for (const grid of this.ship.layersOf()) {
            appendEmissiveBloom(bloom, grid, CELL, this.ship.centerOfMass)
        }

        this.bloomMesh?.destroy()
        this.bloomMesh = bloom.vertexCount > 0
            ? bloom.build(this.context.gpu, "ship bloom")
            : null
    }

    /**
     * Where the ship is and how it is lit, as one instance.
     *
     * Entry 0 of both, since there is one ship - but they are filled together
     * because the lit shader reads surface `i` for instance `i`, and two loops
     * that could disagree about the order is exactly the bug worth designing out.
     */
    private fillShipBatch(): void {
        this.shipBatch.begin()
        this.lights.begin()

        const at = { x: this.body.position.x * CELL, y: this.body.position.y * CELL }
        this.shipBatch.add(at.x, at.y, this.body.angle, 1, 1, 1, 1)

        // The ship's own engines are excluded by owner, so a burn does not wash
        // out the hull it is burning from
        this.lights.add(this.field.sample(at, this.body.angle, this), this.shadingReach)
        this.lights.upload()
    }

    /*~~~ Arena ~~~*/

    private buildWalls(settings: FlightValues): void {
        const key = `${settings.width}x${settings.height}`
        if (key === this.wallsKey) return
        this.wallsKey = key

        const arena = this.arenaOf(settings)
        const { r, g, b } = WALL_COLOR

        const left = arena.minX * CELL
        const right = arena.maxX * CELL
        const top = arena.minY * CELL
        const bottom = arena.maxY * CELL

        const corners = [
            left, top, right, top,
            right, top, right, bottom,
            right, bottom, left, bottom,
            left, bottom, left, top,
        ]

        const out: number[] = []
        for (let i = 0; i < corners.length; i += 2) out.push(corners[i]!, corners[i + 1]!, r, g, b)

        this.walls.write(new Float32Array(out))
    }

    /** Fixed on the arena, never on the ship - you watch it fly, you do not ride it. */
    private fitCamera(settings: FlightValues): void {
        const arena = this.arenaOf(settings)
        const gpu = this.context.gpu

        this.camera.fit(
            arena.minX * CELL, arena.minY * CELL,
            arena.maxX * CELL, arena.maxY * CELL,
            gpu.width, gpu.height, 0.08,
        )
    }

    /*~~~ Readout ~~~*/

    /*~~~ Lighting ~~~*/

    /**
     * Puts the sun where the settings say, and an engine glow on every nozzle.
     *
     * The glows are owned by this scene, so the ship skips them when shading
     * itself: a light sitting inside the hull has no direction to speak of, and
     * its near-field strength would wash the whole sprite out. They still light
     * anything else, which is the point of having them at all.
     */
    private syncLights(settings: FlightValues, firing: readonly number[]): void {
        const angle = (settings.lightAngle * Math.PI) / 180

        this.sun.position = {
            x: Math.cos(angle) * settings.lightDistance,
            y: Math.sin(angle) * settings.lightDistance,
        }
        this.sun.color = Color.from(settings.lightColor)
        this.sun.intensity = settings.lightIntensity
        this.sun.range = settings.lightRange
        this.sun.radius = settings.lightDistance * 0.09

        this.lights.setShading(DEFAULT_SHADING)
        this.syncEngineGlows(firing)
    }

    private syncEngineGlows(firing: readonly number[]): void {
        const cos = Math.cos(this.body.angle)
        const sin = Math.sin(this.body.angle)

        // One per thruster, made once and then only moved: a light per frame
        // would churn the field every tick for no gain
        while (this.engineGlows.length < this.physics.thrusters.length) {
            const glow = new Light({
                position: { x: 0, y: 0 },
                color: EXHAUST_COLOR,
                intensity: 0,
                range: GLOW_RANGE,
                radius: GLOW_RADIUS,
                owner: this,
            })

            this.engineGlows.push(glow)
            this.field.add(glow)
        }

        this.physics.thrusters.forEach((thruster, index) => {
            const glow = this.engineGlows[index]!
            const local = this.worldOf(thruster.offset, cos, sin)

            glow.position = { x: local.x * CELL, y: local.y * CELL }
            glow.intensity = (firing[index] ?? 0) * GLOW_INTENSITY
        })
    }

    /** Every light with anything to show, as a soft blob. */
    private fillGlowBatch(): void {
        this.glowBatch.begin()

        for (const light of this.field.lights) {
            if (light.intensity <= 0.01) continue

            const { r, g, b } = light.color
            const strength = Math.min(light.intensity, 1)

            this.glowBatch.add(
                light.position.x, light.position.y, 0,
                light.radius,
                r * strength, g * strength, b * strength,
            )
        }
    }

    /*~~~ Exhaust ~~~*/

    /**
     * Spawns exhaust behind every engine that is burning, then ages the field.
     *
     * Fed the same throttles the step used rather than its own: a plume that
     * disagreed with the thrust would be a lie about what the ship is doing.
     */
    private updateExhaust(firing: readonly number[], dt: number, settings: FlightValues): void {
        if (!settings.exhaust) {
            // Cleared rather than frozen: leaving a plume hanging in space while the
            // ship flies away looks like a bug, not like a setting
            this.exhaust.clear()
            return
        }

        const cos = Math.cos(this.body.angle)
        const sin = Math.sin(this.body.angle)

        this.physics.thrusters.forEach((thruster, index) => {
            const throttle = firing[index] ?? 0
            const owed = (this.exhaustOwed[index] ?? 0) + EXHAUST_RATE * throttle * dt

            // Whole specks now, the remainder carried to the next frame
            const count = Math.floor(owed)
            this.exhaustOwed[index] = owed - count
            if (count === 0) return

            this.exhaust.emit(count, {
                at: this.worldOf(thruster.offset, cos, sin),
                // Exhaust leaves the way the force does not, which is what makes
                // the ship go the other way in the first place
                direction: this.worldDirection(negated(thruster.force), cos, sin),
                speed: EXHAUST_SPEED * throttle,
                // Inherited, so a plume trails the ship rather than hanging where
                // the ship was when it fired
                drift: this.body.velocity,
                spread: 0.25,
                speedJitter: 0.35,
                life: EXHAUST_LIFE * throttle,
                lifeJitter: 0.3,
                size: EXHAUST_SIZE,
                red: EXHAUST_COLOR.r,
                green: EXHAUST_COLOR.g,
                blue: EXHAUST_COLOR.b,
            })
        })

        this.exhaust.update(dt)
    }

    /** A point in the ship's own space, in world cells. */
    private worldOf(local: Vec2, cos: number, sin: number): Vec2 {
        return {
            x: this.body.position.x + local.x * cos - local.y * sin,
            y: this.body.position.y + local.x * sin + local.y * cos,
        }
    }

    /** A ship-local direction as a world-space unit vector. */
    private worldDirection(local: Vec2, cos: number, sin: number): Vec2 {
        const length = Math.hypot(local.x, local.y) || 1

        return {
            x: (local.x * cos - local.y * sin) / length,
            y: (local.x * sin + local.y * cos) / length,
        }
    }

    /** Fills the batch from the field. One instance per living speck. */
    private fillExhaustBatch(): void {
        this.exhaustBatch.begin().reserve(this.exhaust.count)

        this.exhaust.forEach((particle) => {
            // Fading the colour rather than the alpha: these draw additively, so
            // a dimmer speck simply adds less and needs no blend of its own
            const fade = fadeOf(particle)

            this.exhaustBatch.add(
                particle.position.x * CELL,
                particle.position.y * CELL,
                0,
                particle.size * CELL,
                particle.red * fade,
                particle.green * fade,
                particle.blue * fade,
            )
        })
    }

    private publishInfo(): void {
        this.context.publish("flightInfo", {
            name: this.ship.name,
            mass: this.physics.mass,
            inertia: this.physics.inertia,
            thrusters: this.physics.thrusters.length,
            firing: this.firing,
            speed: Math.hypot(this.body.velocity.x, this.body.velocity.y),
            spin: this.body.spin,
            touching: this.touching,
            assist: this.assist,
        } satisfies FlightInfo)
    }

    render(frame: Frame): void {
        const gpu = this.context.gpu
        const renderer = this.context.renderer
        const { camera, meshLines: linePipeline } = renderer
        const settings = this.settings

        camera.upload(this.camera, gpu.width, gpu.height)

        const ship = this.shipMesh
        if (ship && settings) {
            this.fillShipBatch()

            // Group 1 is the lighting under the lit pipeline and the empty
            // material layout under the plain one, so it is bound with the switch
            if (settings.lit) {
                frame.setPipeline(renderer.lit)
                    .setBindGroup(0, camera.group)
                    .setBindGroup(1, this.lights.group)
            } else {
                frame.setPipeline(renderer.instanced).setBindGroup(0, camera.group)
            }

            this.shipBatch.draw(frame, ship)
        }

        // Glows and exhaust over the hull: a plume is in front of the nozzle it
        // left, and additive means it brightens the hull rather than hiding it
        this.fillGlowBatch()
        this.fillExhaustBatch()

        frame.setPipeline(renderer.instancedGlow).setBindGroup(0, camera.group)

        // The hull's own emissive halo rides the ship's transform, so it is drawn
        // from the same batch that just placed the ship
        if (this.bloomMesh) this.shipBatch.draw(frame, this.bloomMesh)
        if (this.glowBatch.size > 0) this.glowBatch.draw(frame, this.glowMesh)
        if (this.exhaust.count > 0) this.exhaustBatch.draw(frame, this.spark)

        // Lines last so a wall stays visible with the ship pressed against it
        frame.setPipeline(linePipeline).setBindGroup(0, camera.group)
        this.walls.draw(frame)
    }

    dispose(): void {
        this.shipMesh?.destroy()
        this.bloomMesh?.destroy()
        this.walls.destroy()
        this.spark.destroy()
        this.glowMesh.destroy()
        this.exhaustBatch.destroy()
        this.shipBatch.destroy()
        this.glowBatch.destroy()
        this.lights.destroy()
    }
}

const scene: DevSceneDefinition<FlightValues> = {
    id: "ship-flight",
    name: "Ship Flight",
    description:
        "Flies a ship under Newtonian thrust inside a fixed arena. W and S burn along " +
        "the ship's own axis, A and D sideways, Q and E turn on the thrusters marked for " +
        "steering in the builder, and Z toggles flight assist. A ship only turns if it " +
        "was built with steering thrusters off its center of mass.",
    settings: SETTINGS,
    ui: "flight",
    input: "flight",
    create: (context) => new ShipFlight(context),
}

export default scene
