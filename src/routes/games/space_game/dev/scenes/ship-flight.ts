import { buildShip, findShip, SHIPS } from "../../assets/ships"
import { Ship } from "../../game/ship"
import {
    bodyAt, bounce, boundingRadius, shipPhysics, step, throttles,
    type Arena, type Body, type Controls, type ShipPhysics,
} from "../../game/physics"
import { Camera, CameraBinding } from "../../render/camera"
import { Color } from "../../render/color"
import type { Frame } from "../../render/frame"
import { appendLayer } from "../../render/grid/blockDraw"
import { FLOATS_PER_VERTEX, Mesh, MeshBuilder, VERTEX_LAYOUT } from "../../render/mesh"
import { InputService } from "../../input/service"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { Pipeline } from "../../render/webgpu/pipeline"
import { Shader } from "../../render/webgpu/shader"
import type { ActionsOf, SearchColumn, SettingsSchema, ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"

/** World units per cell, matching the builder so a ship is the size you drew it. */
const CELL = 32

const WALL_COLOR = Color.from("#3d6b8c")

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

    assist: { type: "checkbox", label: "Flight assist", default: true },
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
    private readonly cameraBinding: CameraBinding
    private readonly meshPipeline: Pipeline
    private readonly linePipeline: Pipeline

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
    private shipMesh: Mesh | null = null
    private walls: Mesh | null = null

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
        this.cameraBinding = CameraBinding.create(gpu)

        const shader = Shader.createNow(gpu, MESH_2D, "mesh 2d")
        const layouts = [this.cameraBinding.layout]

        this.meshPipeline = Pipeline.create(gpu, {
            label: "flight solid", shader, layouts, vertexBuffers: [VERTEX_LAYOUT],
        })
        this.linePipeline = Pipeline.create(gpu, {
            label: "flight lines", shader, layouts, vertexBuffers: [VERTEX_LAYOUT],
            topology: "line-list",
        })

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

        this.firing = this.countFiring(controls, before.spin, dt)

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

        this.shipMesh?.destroy()
        this.shipMesh = this.local.length > 0
            ? Mesh.create(this.context.gpu, this.frame, "ship")
            : null
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
        if (!this.shipMesh || this.local.length === 0) return

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

        this.shipMesh.update(this.frame)
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

        this.walls?.destroy()
        this.walls = Mesh.create(this.context.gpu, new Float32Array(out), "arena")
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

    /**
     * How many engines are burning, asked of the same function that fires them.
     *
     * Re-running the allocation rather than having `step` report it: the throttles
     * are a pure function of the state it was given, so asking twice cannot
     * disagree with what actually happened.
     */
    private countFiring(controls: Controls, spin: number, dt: number): number {
        return throttles(this.physics, controls, spin, dt)
            .filter((value) => value > 0)
            .length
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
        this.cameraBinding.upload(this.camera, gpu.width, gpu.height)

        frame.setPipeline(this.meshPipeline).setBindGroup(0, this.cameraBinding.group)
        this.shipMesh?.draw(frame)

        // Lines last so a wall stays visible with the ship pressed against it
        frame.setPipeline(this.linePipeline).setBindGroup(0, this.cameraBinding.group)
        this.walls?.draw(frame)
    }

    dispose(): void {
        this.shipMesh?.destroy()
        this.walls?.destroy()
        this.cameraBinding.destroy()
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
