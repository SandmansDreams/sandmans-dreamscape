import { buildShip, findShip, SHIPS } from "../../assets/ships"
import { Ship } from "../../game/ship"
import {
    bodyAt, bounce, boundingRadius, shipPhysics, step, throttles,
    type Arena, type Body, type Controls, type ShipPhysics,
} from "../../game/physics"
import { Camera, type Vec2 } from "../../render/camera"
import { Color } from "../../render/color"
import type { Frame } from "../../render/frame"
import { appendLayer } from "../../render/grid/blockDraw"
import { DynamicMesh, FLOATS_PER_VERTEX, Mesh, MeshBuilder } from "../../render/mesh"
import { InstanceBatch } from "../../render/webgpu/instance"
import { fadeOf, ParticleField } from "../../game/particles"
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
    private physics: ShipPhysics
    private radius = 0
    private body: Body = bodyAt(0, 0)

    /**
     * The ship's triangles about its own center of mass, built once.
     *
     * `frame` starts as a copy, so each tick only rewrites the two position floats
     * per vertex - the colours never move, and re-deriving them sixty times a
     * second would be most of the work for none of the result.
     */
    private local = new Float32Array(0)
    private frame = new Float32Array(0)
    private readonly shipMesh: DynamicMesh
    private readonly walls: DynamicMesh

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
        this.shipMesh = DynamicMesh.create(gpu, "ship")
        this.walls = DynamicMesh.create(gpu, "arena")

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

        this.uploadShip()
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

        this.local = builder.toArray()
        this.frame = new Float32Array(this.local)

        // Empty is a state the mesh holds itself, so a ship with no blocks needs no
        // special case here beyond not building one
        this.shipMesh.write(this.frame)
    }

    /**
     * Rewrites the ship's positions for where it is now.
     *
     * A CPU pass rather than a model transform in the shader: nothing in the
     * vertex format carries a per-draw uniform, and adding one would touch a
     * shader every other scene shares. One ship of a few thousand triangles is
     * nothing; a fleet would want the uniform instead.
     */
    private uploadShip(): void {
        if (this.local.length === 0) return

        const cos = Math.cos(this.body.angle)
        const sin = Math.sin(this.body.angle)
        const px = this.body.position.x * CELL
        const py = this.body.position.y * CELL

        for (let i = 0; i < this.local.length; i += FLOATS_PER_VERTEX) {
            const x = this.local[i]!
            const y = this.local[i + 1]!

            this.frame[i] = px + x * cos - y * sin
            this.frame[i + 1] = py + x * sin + y * cos
        }

        this.shipMesh.write(this.frame)
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
        const { camera, mesh: meshPipeline, meshLines: linePipeline } = this.context.renderer
        camera.upload(this.camera, gpu.width, gpu.height)

        frame.setPipeline(meshPipeline).setBindGroup(0, camera.group)
        this.shipMesh.draw(frame)

        // Exhaust over the hull: a plume is in front of the nozzle it left, and
        // additive means it brightens the hull rather than hiding it
        if (this.exhaust.count > 0) {
            this.fillExhaustBatch()
            frame.setPipeline(this.context.renderer.instancedGlow).setBindGroup(0, camera.group)
            this.exhaustBatch.draw(frame, this.spark)
        }

        // Lines last so a wall stays visible with the ship pressed against it
        frame.setPipeline(linePipeline).setBindGroup(0, camera.group)
        this.walls.draw(frame)
    }

    dispose(): void {
        this.shipMesh.destroy()
        this.walls.destroy()
        this.spark.destroy()
        this.exhaustBatch.destroy()
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
