import { buildShip, findShip, SHIPS } from "../../assets/ships"
import { Ship } from "../../game/ship"
import {
    bodyAt, bounce, boundingRadius, DRY, LOAD_STAGES, loadStage, shipPhysics, step, throttles,
    type Arena, type Body, type Controls, type LoadStages, type ShipPhysics, type Thruster,
} from "../../game/physics"
import {
    fullReserves, shipSystems, tickSystems,
    type Reserves, type ShipSystems,
} from "../../game/shipSystems"
import { Camera, type Vec2 } from "../../render/camera"
import { Color } from "../../render/color"
import type { Frame } from "../../render/frame"
import { appendBlockTop, appendEmissiveBloom, appendLayer } from "../../render/grid/blockDraw"
import { DynamicMesh, Mesh, MeshBuilder } from "../../render/mesh"
import type { Cell } from "../../render/grid/grid"
import { InstanceBatch } from "../../render/webgpu/instance"
import { fadeOf, ParticleField } from "../../game/particles"
import { LightBinding } from "../../render/lighting"
import { glowDisc } from "../../render/glow"
import { DEFAULT_SHADING, Light, LightField } from "../../game/lighting"
import { InputService } from "../../input/service"
import type { SceneContext, SceneInstance } from "../../render/scene"
import type { ActionsOf, SearchColumn, SettingsSchema, ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"
import { sendShip, shipOf, takeHandoff } from "../handoff"
import { emissiveSources, falloff, spillOnto } from "../../game/emissiveSpill"
import { approach } from "../../game/ease"
import { islandAt, powerNetworkOf } from "../../game/powerNetwork"
import { cellKey } from "../../render/grid/grid"
import { ProjectileField, projectileFade } from "../../game/projectiles"
import { driftTarget, isDestroyed, splitTarget, targetAt, type Target } from "../../game/targets"
import {
    aimOf, coolDown, freshStates, leadAngle, nearestInRange, RECOIL_KICK, settleWeapons,
    shotSpeed, weaponMountsOf, willFire,
    type WeaponMount, type WeaponState,
} from "../../game/weapons"
import type { PowerRequest } from "../../game/shipSystems"
import { FLOATS_PER_CELL_GLOW } from "../../render/lighting"

/** World units per cell, matching the builder so a ship is the size you drew it. */
const CELL = 32

const WALL_COLOR = Color.from("#3d6b8c")

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0)
}

/** A unit-radius disc as a triangle fan, for drawing a rock at any size. */
function discMesh(sides: number): MeshBuilder {
    const builder = new MeshBuilder()

    for (let i = 0; i < sides; i++) {
        const from = (i / sides) * Math.PI * 2
        const to = ((i + 1) / sides) * Math.PI * 2

        builder.add([
            0, 0,
            Math.cos(from), Math.sin(from),
            Math.cos(to), Math.sin(to),
        ], Color.WHITE)
    }

    return builder
}

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
/**
 * How far down the plume a speck is born, in cells from the thruster's centre.
 *
 * Half a cell is exactly the mouth - the aft edge of the thruster's own block,
 * which is the lowest thing drawn on the hull. A shade past it, so specks clear
 * the hull rather than looking like they are seeping out of it, and no further:
 * a plume that starts a whole cell out reads as detached from the engine.
 *
 * Turn on "Mark exhaust origins" to see where this lands: white is the thruster's
 * cell, cyan its centre, magenta where specks appear.
 */
const NOZZLE_OFFSET = 0.6

/**
 * How far a burning nozzle throws light across the hull, in cells, and how much.
 *
 * Short and dim: this is the heat washing the plates immediately around the
 * nozzle, not a lamp. It rides the same falloff curve the emissive spill uses,
 * so a strip and an engine agree about what "range" means.
 */
const ENGINE_GLOW_RANGE = 3
const ENGINE_GLOW_STRENGTH = 0.5

/**
 * How much of the gap an engine's light still has to close after a second.
 *
 * A nozzle does not reach full heat the instant the throttle opens, nor go cold
 * the instant it shuts - and following the throttle exactly made a tapped key
 * flash the hull. Small, so it still feels connected to the control: this is a
 * glow settling, not a lamp on a dimmer.
 */
const ENGINE_GLOW_EASE = 0.0002

const GLOW_RANGE = 220
const GLOW_RADIUS = 26
const GLOW_INTENSITY = 0.35

/*~~~ Weapons and targets ~~~*/

/** The most shots in the air at once, across every weapon on the ship. */
const SHOT_CAPACITY = 400

/** How far down the barrel a round appears, in cells. Matches the exhaust rule. */
const MUZZLE_OFFSET = 0.6

const SHOT_SIZE = 0.16
const SHOT_COLOR = Color.from("#9fe8ff")

/** Sparks thrown off where a round lands. */
const IMPACT_SPARKS = 8
const IMPACT_SPEED = 6
const IMPACT_LIFE = 0.3

/**
 * How far a firing muzzle throws light across the hull, and how much.
 *
 * Shorter and harder than an engine's: a burn is a steady wash over the plates
 * around a nozzle, a shot is a bright moment right at the barrel's mouth.
 */
const MUZZLE_GLOW_RANGE = 2.2
const MUZZLE_GLOW_STRENGTH = 0.65

/** How much brighter a barrel itself goes at the instant it fires. */
const BARREL_FLASH_BOOST = 0.85

const TARGET_COLOR = Color.from("#6b6f5a")
/** Rocks start somewhere in this band of the arena, in cells. */
const TARGET_MIN_RADIUS = 0.8
const TARGET_MAX_RADIUS = 2.2
const TARGET_DRIFT = 2.5

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

    systemsSep: { type: "separator", label: "Systems" },

    /*
     * On by default, so a ship that was flyable before this existed still is.
     * Turning it off is what puts the power network in charge: engines nothing
     * reaches go dead, the battery drains under a burn, and the hull browns out.
     */
    infinitePower: { type: "checkbox", label: "Infinite power / fuel", default: true },
    autoAim:       { type: "checkbox", label: "Auto-aim", default: false },
    targets:       { type: "range", label: "Targets", default: 8, min: 0, max: 40, step: 1 },
    respawn:       { type: "button", label: "New Targets" },
    cargoFill:     { type: "range", label: "Cargo load", default: 0, min: 0, max: 1, step: 0.1 },
    refuel:        { type: "button", label: "Refuel" },

    lightSeparator: { type: "separator", label: "Lighting" },

    lit:            { type: "checkbox", label: "Lit", default: true },
    lightAngle:     { type: "range", label: "Angle", default: 210, min: 0, max: 360, step: 5 },
    lightDistance:  { type: "range", label: "Distance", default: 900, min: 100, max: 4000, step: 50 },
    lightIntensity: { type: "range", label: "Intensity", default: 1.2, min: 0, max: 3, step: 0.05 },
    lightRange:     { type: "range", label: "Falloff", default: 1600, min: 200, max: 8000, step: 100 },
    lightColor:     { type: "color", label: "Light Color", default: "#fff3d6" },
    
    debugSep: { type: "separator", label: "Debug" },

    markOrigins: { type: "checkbox", label: "Mark exhaust origins", default: false },

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
    /** Power stored and the most it could hold, summed across every island. */
    power: number
    powerCapacity: number
    fuel: number
    fuelCapacity: number
    /** Power per second being made and spent right now. */
    producing: number
    drawing: number
    /** Engines no generator reaches. Zero on a well-wired ship. */
    unpowered: number
    /** How separate the plant is: more than one means two independent buses. */
    islands: number
    /** False while the panel is paying the bills for you. */
    limited: boolean
    /** True while the turrets are picking their own targets. */
    autoAim: boolean
    /** How many weapons the ship has, and how many can be fed. */
    weapons: number
    weaponsPowered: number
    /** Rocks still in the arena, and rounds in the air. */
    targets: number
    shots: number
    /**
     * The scene the back button returns to, or null when there is nowhere to go.
     *
     * Null is the ordinary case: someone who picked this scene from the list did
     * not come from anywhere, and offering to send them "back" to a place they
     * have never been would be a button that means nothing.
     */
    returnTo: string | null
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
    /**
     * The halo's own instance, so it can be dimmed without dimming the hull.
     *
     * shipBatch's instance colour is white and shared with the ship; the glow
     * pipeline multiplies vertex colour by it, so fading the halo there would
     * fade the whole ship with it.
     */
    private readonly bloomBatch: InstanceBatch
    private readonly lights: LightBinding
    private readonly walls: DynamicMesh

    /*~~~ Lighting ~~~*/
    private readonly field = new LightField()
    private readonly sun = new Light({ position: { x: 0, y: 0 } })
    /** One per thruster, lit by how hard it is burning. Mounted, so self-excluded. */
    private engineGlows: Light[] = []
    private readonly glowBatch: InstanceBatch
    private readonly glowMesh: Mesh

    /**
     * Every cell of the ship, in the order the mesh named them.
     *
     * The mesh hands each cell an index as appendLayer walks it, and the glow
     * buffer is read by that index - so this has to be built by walking the very
     * same loop. Both come off `layersOf()` in `syncShip` for that reason.
     */
    private glowCells: Cell[] = []
    /** rgb + pad per cell, rewritten every frame and handed to the lighting. */
    private cellGlow = new Float32Array(0)
    /**
     * How brightly each engine is lighting the hull, easing toward its throttle.
     *
     * Separate from the throttle itself, which has to stay exact: thrust, exhaust
     * and the readout all read that, and smoothing it would have the ship
     * accelerating on a curve the physics never agreed to.
     */
    private glowLevel: number[] = []

    /*~~~ Weapons ~~~*/
    /** Rebuilt with the physics, since a mount's offset is from the centre of mass. */
    private mounts: WeaponMount[] = []
    private weaponStates: WeaponState[] = []
    /** The island feeding each mount, resolved with the ship. -1 for none. */
    private weaponIsland: number[] = []
    private readonly shots = new ProjectileField(SHOT_CAPACITY)
    private readonly shotBatch: InstanceBatch
    private targets: Target[] = []
    private readonly targetBatch: InstanceBatch
    /** One unit disc, scaled per rock by its radius. */
    private readonly discMesh: Mesh
    /**
     * A turret's barrel, centred so it turns about itself, one mesh per art.
     *
     * Shared by art rather than held per mount, because an InstanceBatch draws its
     * mesh once for every instance in it: a mesh per mount would mean either a
     * draw call per turret or every barrel appearing at every mount.
     */
    private readonly turretMeshes = new Map<string, Mesh>()
    /**
     * One batch per barrel design, rather than one batch reused across draws.
     *
     * `queue.writeBuffer` is ordered against submit, not against the draws
     * recorded between the writes: refilling a single batch between draws means
     * every draw reads whatever the *last* write left, so one design's barrels
     * end up drawn at another's mounts. The same hazard the camera binding
     * documents, and it looks like a mixup rather than like a race.
     */
    private readonly turretBatches = new Map<string, InstanceBatch>()
    /** Which barrel each mount uses, or null for one that does not turn. */
    private turretArt: (string | null)[] = []
    /** Cells whose barrel is drawn per mount, so the hull mesh can skip it. */
    private turretCells = new Set<number>()
    /** Arena and count the rocks were laid out for, so they are not respawned every frame. */
    private targetsKey = ""

    /*~~~ Exhaust ~~~*/
    private readonly exhaust = new ParticleField(EXHAUST_CAPACITY)
    private readonly exhaustBatch: InstanceBatch
    /** Debug dots for the exhaust origins. Empty unless the checkbox is on. */
    private readonly markerBatch: InstanceBatch
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

    /*~~~ Systems ~~~*/
    private systems: ShipSystems
    private reserves: Reserves
    /**
     * The load the physics snapshot was built for.
     *
     * Held so the snapshot is rebuilt only when a stage boundary is crossed -
     * about once every twenty seconds on a draining tank, rather than every frame.
     */
    private load: LoadStages = DRY
    /** 0..1, how brightly the hull's emissive cells burn. */
    private emissionGain = 1
    /** Which weapons the last tick agreed to pay for, parallel to `wants`. */
    private granted: boolean[] = []
    /** Power per second made and spent last frame, for the readout only. */
    private producing = 0
    private drawing = 0

    private builtShip = ""
    private wallsKey = ""
    private firing = 0
    private touching = false

    private assist = true
    /** The checkbox as it was last seen, so a click on it beats the key. */
    private assistSetting: boolean | null = null

    readonly actions: Record<ActionsOf<typeof SETTINGS>, () => void> = {
        reset: () => this.resetBody(),
        refuel: () => { this.reserves = fullReserves(this.systems) },
        // Cleared rather than refilled here: the key is what update() compares
        // against, so blanking it is the one way to say "build them again"
        respawn: () => { this.targetsKey = "" },
    }

    /**
     * The ship that was handed to this scene, if any, and where it came from.
     *
     * Taken once in the constructor rather than read per frame: the handoff is
     * consumed on read, so whoever asks first is the only one who can have it.
     */
    private readonly arrived = takeHandoff()

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        this.input = context.input
        this.walls = DynamicMesh.create(gpu, "arena")

        this.shipBatch = InstanceBatch.create(gpu, context.renderer.instanceLayout, 4, "flight ship")
        this.bloomBatch = InstanceBatch.create(gpu, context.renderer.instanceLayout, 4, "flight bloom")
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

        this.markerBatch = InstanceBatch.create(
            gpu, context.renderer.instanceLayout, 256, "exhaust markers",
        )

        this.shotBatch = InstanceBatch.create(
            gpu, context.renderer.instanceLayout, SHOT_CAPACITY, "shots",
        )
        this.targetBatch = InstanceBatch.create(
            gpu, context.renderer.instanceLayout, 256, "targets",
        )

        // A ring of triangles rather than a quad: a rock reads as a rock and not
        // as a crate, and at this size a dozen sides is already round enough
        this.discMesh = discMesh(12).build(gpu, "target disc")

        // A real ship arrives on the first update; this keeps every field valid
        // until then rather than leaving them undefined
        this.ship = new Ship("empty", "Empty")
        this.physics = shipPhysics(this.ship, DRY)
        this.systems = shipSystems(this.ship, this.physics)
        this.reserves = fullReserves(this.systems)
    }

    update(dt: number, settings: FlightValues): void {
        this.settings = settings
        this.syncShip(settings)
        this.buildWalls(settings)
        this.fitCamera(settings)
        this.syncAssist(settings)

        const controls = this.readControls()
        const before = this.body

        // One array, three consumers. step() used to work out its own from the
        // same controls and the same pre-step spin, so the two agreed by luck
        // rather than by construction - and would stop agreeing the moment either
        // side scaled its copy back.
        // Aiming before the tick, so a trigger pull is asked for on the same
        // budget as the thrust it competes with rather than after it
        const wants = this.aimWeapons(dt, settings)
        const requests: PowerRequest[] = wants.map((want) => ({
            island: want.island,
            amount: settings.infinitePower ? 0 : this.mounts[want.index]!.draw,
        }))

        const wanted = throttles(this.physics, controls, before.spin, dt)
        const firing = this.runSystems(wanted, dt, settings, requests)

        this.fireWeapons(wants, this.granted)

        // dt arrives already clamped by the frame loop, which caps a backgrounded
        // tab's catch-up for exactly this reason. Clamping again here only made the
        // simulation run slower than real time whenever frames were scarce.
        this.body = step(this.body, this.physics, firing, dt)
        const flown = this.body
        this.body = bounce(this.body, this.radius, this.arenaOf(settings), settings.bounciness)

        // A bounce is the only thing that changes velocity here, so comparing the
        // two is cheaper and more honest than re-deriving which wall was hit
        this.touching = this.body.velocity.x !== flown.velocity.x
            || this.body.velocity.y !== flown.velocity.y

        this.firing = firing.filter((throttle) => throttle > 0).length

        this.syncTargets(settings)
        this.updateCombat(dt, settings)
        this.updateExhaust(firing, dt, settings)
        this.syncLights(settings, firing, dt)
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

    /**
     * Back to the start line with full tanks.
     *
     * Refuelling is part of resetting rather than a separate step: a ship put
     * back at the origin still coasting on an empty battery is not a reset, it is
     * the same dead ship somewhere else.
     */
    private resetBody(): void {
        this.body = bodyAt(0, 0)
        this.reserves = fullReserves(this.systems)
    }

    /*~~~ Weapons ~~~*/

    /**
     * Rebuilds the mounts and the island each one draws from.
     *
     * With the physics rather than with the ship: a mount's offset is measured
     * from the centre of mass, so a load stage crossing has to rebuild these too
     * or every barrel sits a little off the block it belongs to.
     */
    private syncWeapons(): void {
        const network = powerNetworkOf(this.ship)

        this.mounts = weaponMountsOf(this.ship, this.physics)
        this.weaponStates = freshStates(this.mounts)
        this.weaponIsland = this.mounts.map((mount) => islandAt(network, mount.col, mount.row))
        this.shots.clear()

        for (const mesh of this.turretMeshes.values()) mesh.destroy()
        for (const batch of this.turretBatches.values()) batch.destroy()
        this.turretMeshes.clear()
        this.turretBatches.clear()
        this.turretArt = []
        this.turretCells = new Set()

        // Only what actually turns: a fixed mount's barrel is welded to the hull,
        // and lifting it out of the ship's mesh would cost a draw to change nothing
        for (const mount of this.mounts) {
            const cell = this.cellOf(mount)
            if (!cell || mount.traverse <= 0) {
                this.turretArt.push(null)
                continue
            }

            // Colour is part of the key: two turrets of one type painted
            // differently are two different barrels
            const key = `${cell.type}|${cell.level}|${cell.color.hex}|${cell.accentColor?.hex ?? ""}`

            if (!this.turretMeshes.has(key)) {
                const builder = new MeshBuilder()
                appendBlockTop(builder, cell, CELL)

                if (builder.vertexCount === 0) {
                    this.turretArt.push(null)
                    continue
                }

                this.turretMeshes.set(key, builder.build(this.context.gpu, "turret"))
                this.turretBatches.set(key, InstanceBatch.create(
                    this.context.gpu, this.context.renderer.instanceLayout, 64, `turret ${key}`,
                ))
            }

            this.turretCells.add(cellKey(mount.col, mount.row))
            this.turretArt.push(key)
        }
    }

    /**
     * The cell a mount came from, since a mount is only a snapshot of one.
     *
     * By layer, not by searching: a weapon sits over a hull plate at the same
     * column and row, and a search would find the plate every time.
     */
    private cellOf(mount: WeaponMount): Cell | null {
        return this.ship.layers[mount.layer].get(mount.col, mount.row) ?? null
    }

    /**
     * Places every turret's barrel at its mount, turned to where it is aiming.
     *
     * The art is authored pointing north, which atan2 calls -90 degrees, so the
     * instance has to make up that quarter turn before the aim means anything.
     */
    private fillTurretBatch(key: string): InstanceBatch | null {
        const batch = this.turretBatches.get(key)
        if (!batch) return null

        batch.begin()

        const cos = Math.cos(this.body.angle)
        const sin = Math.sin(this.body.angle)

        this.mounts.forEach((mount, index) => {
            if (this.turretArt[index] !== key) return

            const state = this.weaponStates[index]!
            const at = this.worldOf(mount.offset, cos, sin)
            const aim = state.angle + this.body.angle

            // Driven back down its own line, so the kick is along the barrel
            // whichever way the turret happens to be pointing
            const back = state.recoil

            // Past one on purpose: the instanced shader multiplies the vertex
            // colour by this, so over-driving it brightens the barrel's own art
            // rather than tinting it
            const lit = 1 + state.flash * BARREL_FLASH_BOOST

            batch.add(
                (at.x - Math.cos(aim) * back) * CELL,
                (at.y - Math.sin(aim) * back) * CELL,
                aim + Math.PI / 2,
                1, lit, lit, lit, 1,
            )
        })

        return batch
    }

    /**
     * Whether an island can move and fire what is wired to it.
     *
     * Wired *and* holding charge, not merely wired: a barrel is turned by the
     * ship, so a hull that has browned out has nothing to turn it with. The
     * reserves are last frame's - the tick has not run yet - and a single frame
     * of lag on a turret seizing is not something anyone can see.
     */
    private isPowered(island: number, settings: FlightValues): boolean {
        if (settings.infinitePower) return true
        if (island < 0) return false

        return (this.reserves.power[island] ?? 0) > 0
    }

    /** Where the pilot is pointing, in world cells. */
    private aimPoint(): Vec2 {
        const world = this.camera.screenToWorld(this.input.pointer.x, this.input.pointer.y)
        return { x: world.x / CELL, y: world.y / CELL }
    }

    /**
     * Where one mount has to point to put a round on the cursor, ship-local.
     *
     * Measured from the mount rather than from the ship, so a spread of turrets
     * converges on the point instead of firing parallel past it. On a hull as
     * wide as the Scooner that is the difference between a volley landing on the
     * rock and landing either side of it.
     *
     * Rotated out of world space at the end, so a mount can compare it against
     * its own facing without knowing the ship's heading.
     */
    private aimFor(mount: WeaponMount, cos: number, sin: number, at: Vec2): number {
        const from = this.worldOf(mount.offset, cos, sin)
        return Math.atan2(at.y - from.y, at.x - from.x) - this.body.angle
    }

    /**
     * Where a mount should point to hit the nearest rock it can reach, or null.
     *
     * Per mount rather than one target for the ship: each barrel picks what is
     * nearest to *it*, so a hull with turrets fore and aft covers both ends
     * instead of every gun swinging onto the same rock.
     *
     * Null when nothing is in reach, and the caller holds fire rather than
     * falling back to the cursor: auto-aim is a mode, not a hint, and a turret
     * that keeps shooting at empty space because the pointer happens to be there
     * is not aiming at anything.
     */
    private autoAimFor(mount: WeaponMount, cos: number, sin: number): number | null {
        const from = this.worldOf(mount.offset, cos, sin)
        const target = nearestInRange(from, mount.range, this.targets)
        if (!target) return null

        return leadAngle(from, target, shotSpeed(mount)) - this.body.angle
    }

    /**
     * Slews every mount and returns what firing would cost, mount by mount.
     *
     * Aim and cooldown advance whether or not the trigger is down: a turret should
     * already be tracking when you decide to shoot, not start turning afterwards.
     */
    private aimWeapons(dt: number, settings: FlightValues): { index: number; island: number }[] {
        coolDown(this.weaponStates, dt)
        settleWeapons(this.weaponStates, dt)
        if (this.mounts.length === 0) return []

        const at = this.aimPoint()
        const cos = Math.cos(this.body.angle)
        const sin = Math.sin(this.body.angle)

        // Holding the mouse always means "aim here and fire". Auto-aim decides
        // what the guns do when you are *not* pointing, not whether you may.
        const manual = this.input.pointer.isDown()

        // Auto-aim pulls its own trigger: making it wait for the mouse too would
        // leave it a slower way of doing what pointing already does
        const triggered = settings.autoAim || manual
        const wants: { index: number; island: number }[] = []

        this.mounts.forEach((mount, index) => {
            const state = this.weaponStates[index]!
            const island = this.weaponIsland[index] ?? -1
            const powered = this.isPowered(island, settings)

            // Null only reaches here on a mount left to itself with nothing in
            // reach: it holds where it is and holds fire, rather than shooting at
            // wherever the pointer happens to be resting
            const aim = manual || !settings.autoAim
                ? this.aimFor(mount, cos, sin, at)
                : this.autoAimFor(mount, cos, sin)

            if (aim === null) return

            state.angle = aimOf(mount, state, aim, dt, powered)

            if (willFire(mount, state, aim, triggered, powered)) wants.push({ index, island })
        })

        return wants
    }

    /** Fires the mounts whose power was granted, in the order they asked. */
    private fireWeapons(wants: { index: number }[], granted: readonly boolean[]): void {
        const cos = Math.cos(this.body.angle)
        const sin = Math.sin(this.body.angle)

        wants.forEach((want, slot) => {
            if (!granted[slot]) return

            const mount = this.mounts[want.index]!
            const state = this.weaponStates[want.index]!

            const heading = state.angle + this.body.angle
            const direction = { x: Math.cos(heading), y: Math.sin(heading) }
            const at = this.worldOf(mount.offset, cos, sin)

            this.shots.fire({
                // Down the barrel, so a round is not born inside the block it left
                at: {
                    x: at.x + direction.x * MUZZLE_OFFSET,
                    y: at.y + direction.y * MUZZLE_OFFSET,
                },
                direction,
                speed: shotSpeed(mount),
                carry: this.body.velocity,
                damage: mount.damage,
                range: mount.range,
            })

            state.cooldown = mount.cooldown
            state.recoil = RECOIL_KICK
            state.flash = 1
        })
    }

    /**
     * Advances every rock and every round, and breaks what was destroyed.
     *
     * Splitting happens here rather than in the projectile field because a rock
     * coming apart is about the arena, not about the round that did it - and the
     * field would otherwise have to know how to make rocks.
     */
    private updateCombat(dt: number, settings: FlightValues): void {
        const arena = this.arenaOf(settings)

        for (const target of this.targets) {
            driftTarget(target, dt)

            // The same walls the ship bounces off, so a rock cannot quietly leave
            const bounced = bounce(
                { position: target.position, velocity: target.velocity, angle: 0, spin: 0 },
                target.radius, arena, 1,
            )

            target.position = bounced.position
            target.velocity = bounced.velocity
        }

        for (const impact of this.shots.step(dt, this.targets)) {
            this.exhaust.emit(IMPACT_SPARKS, {
                at: impact.at,
                direction: { x: 0, y: -1 },
                speed: IMPACT_SPEED,
                drift: { x: 0, y: 0 },
                spread: Math.PI,
                speedJitter: 0.6,
                life: IMPACT_LIFE,
                lifeJitter: 0.4,
                size: EXHAUST_SIZE,
                red: SHOT_COLOR.r,
                green: SHOT_COLOR.g,
                blue: SHOT_COLOR.b,
            })
        }

        const broken = this.targets.filter(isDestroyed)
        if (broken.length === 0) return

        this.targets = this.targets.filter((target) => !isDestroyed(target))
        for (const target of broken) this.targets.push(...splitTarget(target))
    }

    /** Lays out a fresh field of rocks, clear of where the ship starts. */
    private syncTargets(settings: FlightValues): void {
        const key = `${settings.targets}|${settings.width}x${settings.height}`
        if (key === this.targetsKey) return
        this.targetsKey = key

        const arena = this.arenaOf(settings)
        this.targets = []
        this.shots.clear()

        for (let i = 0; i < settings.targets; i++) {
            const radius = TARGET_MIN_RADIUS + Math.random() * (TARGET_MAX_RADIUS - TARGET_MIN_RADIUS)
            const spawn = {
                x: arena.minX + Math.random() * (arena.maxX - arena.minX),
                y: arena.minY + Math.random() * (arena.maxY - arena.minY),
            }

            // Not on top of the ship: a rock spawned inside the hull is one the
            // player never had a chance to avoid
            if (Math.hypot(spawn.x, spawn.y) < this.radius + radius + 4) continue

            this.targets.push(targetAt(
                spawn,
                {
                    x: (Math.random() - 0.5) * TARGET_DRIFT,
                    y: (Math.random() - 0.5) * TARGET_DRIFT,
                },
                radius,
                (Math.random() - 0.5) * 1.5,
            ))
        }
    }

    /*~~~ Systems ~~~*/

    /** Where the cargo slider sits on the mass staircase. */
    private cargoStage(settings: FlightValues): number {
        return Math.round(settings.cargoFill * LOAD_STAGES)
    }

    /**
     * Burn fuel, make power, spend it, and hand back the throttles that survived.
     *
     * The one place the plant touches the frame. With the panel's infinite toggle
     * on it does nothing at all and the throttles pass straight through, which is
     * how the scene behaved before any of this existed.
     */
    private runSystems(
        wanted: readonly number[],
        dt: number,
        settings: FlightValues,
        requests: readonly PowerRequest[] = [],
    ): number[] {
        if (settings.infinitePower) {
            this.granted = requests.map(() => true)
            this.reserves = fullReserves(this.systems)
            this.emissionGain = 1
            this.producing = 0
            this.drawing = 0
            this.syncLoad({ fuel: LOAD_STAGES, cargo: this.cargoStage(settings) })

            return [...wanted]
        }

        const tick = tickSystems(this.systems, this.reserves, wanted, dt, requests)

        this.granted = tick.granted
        this.reserves = tick.reserves
        this.emissionGain = tick.emissionGain
        this.producing = tick.producing
        this.drawing = tick.drawing

        this.syncLoad({
            fuel: loadStage(tick.reserves.fuel, this.systems.fuelCapacity),
            cargo: this.cargoStage(settings),
        })

        return tick.firing
    }

    /**
     * Rebuilds the physics snapshot, but only when the load actually stepped.
     *
     * The whole reason the fill is quantised: mass feeds the centre of mass, the
     * inertia and every thruster's leverage, so this would otherwise be a full
     * rebuild every frame instead of one every twenty seconds or so.
     */
    private syncLoad(load: LoadStages): void {
        if (load.fuel === this.load.fuel && load.cargo === this.load.cargo) return

        this.load = load
        this.physics = shipPhysics(this.ship, load)
        // The thruster array was just rebuilt, so the island each engine sits on
        // has to be looked up against the new order or the two fall out of step
        this.systems = shipSystems(this.ship, this.physics)

        // Mounts hang off the centre of mass too, and it just moved
        const aiming = this.weaponStates.map((state) => state.angle)
        this.syncWeapons()
        this.weaponStates.forEach((state, index) => { state.angle = aiming[index] ?? state.angle })
    }

    /*~~~ Ship ~~~*/

    private syncShip(settings: FlightValues): void {
        // The handed-over ship is loaded once, on the first frame, and the picker
        // takes over from there: changing the ship in the panel should still work
        // after arriving from the builder
        const handed = this.builtShip === "" ? this.arrived : null
        if (!handed && settings.ship === this.builtShip) return
        this.builtShip = settings.ship

        this.exhaust.clear()
        this.exhaustOwed = []

        this.ship = handed ? shipOf(handed) : buildShip(settings.ship)

        // Full, because a ship arriving for a test flight should start fuelled.
        // Note that this is the only place it can be decided: handoff.ts writes
        // the ship out as JSON, so no amount of fuel would survive the trip from
        // the builder anyway.
        this.load = { fuel: LOAD_STAGES, cargo: this.cargoStage(settings) }
        this.physics = shipPhysics(this.ship, this.load)
        this.systems = shipSystems(this.ship, this.physics)
        this.syncWeapons()
        this.radius = boundingRadius(this.ship)
        this.resetBody()

        // Origin at the dry centre of mass: it is the one centre a mesh can be
        // baked about and keep, since the loaded one moves every time the fuel
        // steps. fillShipBatch draws the mesh at wherever that origin currently
        // is, so the ship still turns about the point the physics spins it around.
        const builder = new MeshBuilder()
        // One array, walked twice: the mesh indexes cells in exactly this order,
        // and the glow buffer is read by that index. Two separate walks that
        // happen to agree today is precisely the bug worth designing out.
        const layers = this.ship.layersOf()
        const sources = emissiveSources(layers)

        this.glowCells = layers.flatMap((grid) => grid.list)
        this.cellGlow = new Float32Array(this.glowCells.length * FLOATS_PER_CELL_GLOW)

        for (const grid of layers) {
            appendLayer(
                builder, grid, CELL, this.ship.centerOfMass, 0, Color.BLACK,
                spillOnto(grid, sources), (cell) => this.turretCells.has(cellKey(cell.col, cell.row)),
            )
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

        const cos = Math.cos(this.body.angle)
        const sin = Math.sin(this.body.angle)
        const origin = this.worldOf(this.meshOffset(), cos, sin)

        const at = { x: origin.x * CELL, y: origin.y * CELL }
        this.shipBatch.add(at.x, at.y, this.body.angle, 1, 1, 1, 1)

        // Same transform, dimmed colour: the halo fades with the windows rather
        // than hanging over a hull that has already gone dark
        const gain = this.emissionGain
        this.bloomBatch.begin()
        this.bloomBatch.add(at.x, at.y, this.body.angle, 1, gain, gain, gain, 1)

        // The ship's own engines are excluded by owner, so a burn does not wash
        // out the hull it is burning from
        this.lights.add(this.field.sample(at, this.body.angle, this), this.shadingReach, gain)
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

    /**
     * Goes back where the ship came from, carrying it home.
     *
     * The same ship is handed back rather than the builder reloading from its
     * picker: what left the builder was usually an unsaved edit, and reloading
     * would silently throw it away.
     */
    private returnHome(): void {
        const home = this.arrived
        if (!home) return

        sendShip(this.ship, "ship-flight")
        this.context.publish("goto", home.from)
    }

    /** A message from the panel. Only the back button sends one. */
    receive(key: string): void {
        if (key === "back") this.returnHome()
    }

    /*~~~ Lighting ~~~*/

    /**
     * Puts the sun where the settings say, and an engine glow on every nozzle.
     *
     * The glows are owned by this scene, so the ship skips them when shading
     * itself: a light sitting inside the hull has no direction to speak of, and
     * its near-field strength would wash the whole sprite out. They still light
     * anything else, which is the point of having them at all.
     */
    private syncLights(settings: FlightValues, firing: readonly number[], dt: number): void {
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
        this.syncCellGlow(firing, dt)
    }

    /**
     * How much each cell is lit by the engines burning near it, this frame.
     *
     * Ship-local throughout: a nozzle and a cell are both fixed to the hull, so
     * none of this needs the ship's world position or rotation - which is also
     * why it survives the ship spinning without any of it being recomputed.
     *
     * A flat scan over cells x firing engines. About twelve hundred comparisons
     * on a big ship, which is cheaper than the bookkeeping any index would need
     * to avoid them.
     */
    private syncCellGlow(firing: readonly number[], dt: number): void {
        // Eased even when there is no buffer to write into, or a ship swapped
        // mid-burn would come back holding the last one's heat
        this.physics.thrusters.forEach((_, index) => {
            this.glowLevel[index] = approach(
                this.glowLevel[index] ?? 0, firing[index] ?? 0, ENGINE_GLOW_EASE, dt,
            )
        })
        this.glowLevel.length = this.physics.thrusters.length

        const glow = this.cellGlow
        if (glow.length === 0) return

        // Whole, not patched: a cell left holding last frame's value is a plate
        // that keeps glowing after its engine has stopped
        glow.fill(0)

        const rangeSq = ENGINE_GLOW_RANGE * ENGINE_GLOW_RANGE

        this.physics.thrusters.forEach((thruster, index) => {
            const throttle = this.glowLevel[index] ?? 0
            // Under a thousandth there is nothing to see, and skipping it keeps
            // the inner loop off every cell for an engine that is effectively out
            if (throttle <= 0.001) return

            // The nozzle mouth in grid space, matching where the specks appear
            const fx = -thruster.force.x
            const fy = -thruster.force.y
            const length = Math.hypot(fx, fy) || 1
            const atCol = thruster.col + 0.5 + (fx / length) * NOZZLE_OFFSET
            const atRow = thruster.row + 0.5 + (fy / length) * NOZZLE_OFFSET

            const amount = throttle * ENGINE_GLOW_STRENGTH

            this.glowCells.forEach((cell, slot) => {
                const dc = cell.col + 0.5 - atCol
                const dr = cell.row + 0.5 - atRow
                const strength = amount * falloff(dc * dc + dr * dr, rangeSq)
                if (strength <= 0) return

                const at = slot * FLOATS_PER_CELL_GLOW
                glow[at] = (glow[at] ?? 0) + EXHAUST_COLOR.r * strength
                glow[at + 1] = (glow[at + 1] ?? 0) + EXHAUST_COLOR.g * strength
                glow[at + 2] = (glow[at + 2] ?? 0) + EXHAUST_COLOR.b * strength
            })
        })

        this.addMuzzleGlow(glow)
        this.lights.writeCellGlow(glow)
    }

    /**
     * Adds each firing muzzle's light to the same per-cell buffer the engines use.
     *
     * The same falloff and the same buffer, so a shot and a burn light the hull
     * in one language rather than two - only the colour, the range and how fast
     * it dies tell them apart.
     */
    private addMuzzleGlow(glow: Float32Array): void {
        const rangeSq = MUZZLE_GLOW_RANGE * MUZZLE_GLOW_RANGE

        this.mounts.forEach((mount, index) => {
            const state = this.weaponStates[index]!
            if (state.flash <= 0.001) return

            // The mouth of the barrel where it is pointing now, which is where
            // the round left from
            const atCol = mount.col + 0.5 + Math.cos(state.angle) * MUZZLE_OFFSET
            const atRow = mount.row + 0.5 + Math.sin(state.angle) * MUZZLE_OFFSET
            const amount = state.flash * MUZZLE_GLOW_STRENGTH

            this.glowCells.forEach((cell, slot) => {
                const dc = cell.col + 0.5 - atCol
                const dr = cell.row + 0.5 - atRow
                const strength = amount * falloff(dc * dc + dr * dr, rangeSq)
                if (strength <= 0) return

                const at = slot * FLOATS_PER_CELL_GLOW
                glow[at] = (glow[at] ?? 0) + SHOT_COLOR.r * strength
                glow[at + 1] = (glow[at + 1] ?? 0) + SHOT_COLOR.g * strength
                glow[at + 2] = (glow[at + 2] ?? 0) + SHOT_COLOR.b * strength
            })
        })
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
            // The point the specks are born at, not the block's centre: the heat
            // belongs behind the plume rather than inside the engine making it
            const { at } = this.nozzleOf(thruster, cos, sin)

            glow.position = { x: at.x * CELL, y: at.y * CELL }
            // The eased level, not the raw throttle, so a nozzle's own light comes
            // up and dies away with the heat it is standing in for
            glow.intensity = (this.glowLevel[index] ?? 0) * GLOW_INTENSITY
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
    /**
     * Where a thruster's exhaust is born and which way it leaves, in world cells.
     *
     * One function for both the specks and the debug marker, so a marker can
     * never disagree with what it is describing - the same rule the outlines
     * follow by tracing the drawing code rather than re-deriving it.
     */
    private nozzleOf(thruster: Thruster, cos: number, sin: number): { at: Vec2; direction: Vec2 } {
        // Exhaust leaves the way the force does not, which is what makes the ship
        // go the other way in the first place
        const direction = this.worldDirection(negated(thruster.force), cos, sin)
        const centre = this.worldOf(thruster.offset, cos, sin)

        return {
            at: {
                x: centre.x + direction.x * NOZZLE_OFFSET,
                y: centre.y + direction.y * NOZZLE_OFFSET,
            },
            direction,
        }
    }

    /**
     * A dot on each thruster's cell centre and on the point its specks are born.
     *
     * Cyan is the centre of the block, magenta is the spawn point, and the gap
     * between them is NOZZLE_OFFSET. Drawn opaque and last so nothing can hide it.
     */
    private fillMarkerBatch(): void {
        this.markerBatch.begin()

        const cos = Math.cos(this.body.angle)
        const sin = Math.sin(this.body.angle)
        const size = 0.22 * CELL

        for (const thruster of this.physics.thrusters) {
            const centre = this.worldOf(thruster.offset, cos, sin)
            const { at } = this.nozzleOf(thruster, cos, sin)

            // Cornered off the offset rather than off centerOfMass a second time:
            // one origin for the dots and the corners is what makes white corners
            // that fail to bracket the nozzle art mean something.
            for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
                const corner = this.worldOf(
                    { x: thruster.offset.x + dc - 0.5, y: thruster.offset.y + dr - 0.5 },
                    cos,
                    sin,
                )
                this.markerBatch.add(corner.x * CELL, corner.y * CELL, 0, size * 0.7, 1, 1, 1, 1)
            }

            this.markerBatch.add(centre.x * CELL, centre.y * CELL, 0, size, 0, 1, 1, 1)
            this.markerBatch.add(at.x * CELL, at.y * CELL, 0, size, 1, 0, 1, 1)
        }
    }

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

            const { at, direction } = this.nozzleOf(thruster, cos, sin)

            this.exhaust.emit(count, {
                at,
                direction,
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

    /**
     * Where the mesh's origin sits in the ship's own space, in cells.
     *
     * The mesh is baked about the dry centre of mass - stable, so it survives a
     * tank draining - while the body flies and spins about the loaded one, and a
     * full tank walks those two apart. Drawing at this point instead of at the
     * body puts the art back under the physics: every offset a thruster reports
     * is measured from the loaded centre, so without it the plumes, the glows and
     * the markers all sit that far off the nozzles they belong to.
     */
    private meshOffset(): Vec2 {
        const origin = this.ship.centerOfMass

        return {
            x: origin.x - this.physics.center.x,
            y: origin.y - this.physics.center.y,
        }
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
            power: sum(this.reserves.power),
            powerCapacity: sum(this.systems.islands.map((island) => island.capacity)),
            fuel: this.reserves.fuel,
            fuelCapacity: this.systems.fuelCapacity,
            producing: this.producing,
            drawing: this.drawing,
            unpowered: this.systems.thrusters.filter((load) => load.island < 0).length,
            weapons: this.mounts.length,
            weaponsPowered: this.weaponIsland.filter((island) => island >= 0).length,
            targets: this.targets.length,
            shots: this.shots.count,
            islands: this.systems.islands.length,
            limited: !this.settings?.infinitePower,
            autoAim: this.settings?.autoAim ?? false,
            returnTo: this.arrived?.from ?? null,
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

        // Rocks under the ship and under everything glowing: they are scenery,
        // and a plume passing over one should read as passing over it
        if (this.targets.length > 0) {
            this.targetBatch.begin()
            for (const target of this.targets) {
                this.targetBatch.add(
                    target.position.x * CELL,
                    target.position.y * CELL,
                    target.angle,
                    target.radius * CELL,
                    TARGET_COLOR.r, TARGET_COLOR.g, TARGET_COLOR.b, 1,
                )
            }

            frame.setPipeline(renderer.instanced).setBindGroup(0, camera.group)
            this.targetBatch.draw(frame, this.discMesh)
        }

        // Barrels over the hull they are mounted on, still solid: they are part of
        // the ship rather than something glowing on it
        if (this.turretMeshes.size > 0) {
            frame.setPipeline(renderer.instanced).setBindGroup(0, camera.group)

            // One draw per barrel design, each with its own batch: sharing one
            // would have every design drawn at the last design's mounts
            for (const [key, mesh] of this.turretMeshes) {
                const batch = this.fillTurretBatch(key)
                if (batch && batch.size > 0) batch.draw(frame, mesh)
            }
        }

        // Glows and exhaust over the hull: a plume is in front of the nozzle it
        // left, and additive means it brightens the hull rather than hiding it
        this.fillGlowBatch()
        this.fillExhaustBatch()

        frame.setPipeline(renderer.instancedGlow).setBindGroup(0, camera.group)

        // The hull's own emissive halo rides the ship's transform, so it is drawn
        // from the same batch that just placed the ship
        if (this.bloomMesh) this.bloomBatch.draw(frame, this.bloomMesh)
        if (this.glowBatch.size > 0) this.glowBatch.draw(frame, this.glowMesh)
        if (this.exhaust.count > 0) this.exhaustBatch.draw(frame, this.spark)

        // Rounds last of the additive pass: a shot leaving a muzzle should sit
        // over its own flash rather than under it
        if (this.shots.count > 0) {
            this.shotBatch.begin().reserve(this.shots.count)
            this.shots.forEach((shot) => {
                // Fading the colour rather than the alpha, the same way the
                // exhaust does: these draw additively, so a dimmer round simply
                // adds less and needs no blend of its own
                const fade = projectileFade(shot)

                this.shotBatch.add(
                    shot.position.x * CELL,
                    shot.position.y * CELL,
                    0,
                    SHOT_SIZE * CELL,
                    SHOT_COLOR.r * fade, SHOT_COLOR.g * fade, SHOT_COLOR.b * fade, 1,
                )
            })

            this.shotBatch.draw(frame, this.spark)
        }

        // Lines last so a wall stays visible with the ship pressed against it
        frame.setPipeline(linePipeline).setBindGroup(0, camera.group)
        this.walls.draw(frame)

        // Over everything, opaque: a debug marker that something else can cover
        // is a debug marker that can lie about where it is
        if (settings?.markOrigins) {
            this.fillMarkerBatch()
            frame.setPipeline(renderer.instanced).setBindGroup(0, camera.group)
            this.markerBatch.draw(frame, this.spark)
        }
    }

    dispose(): void {
        this.shipMesh?.destroy()
        this.bloomMesh?.destroy()
        this.walls.destroy()
        this.spark.destroy()
        this.glowMesh.destroy()
        this.exhaustBatch.destroy()
        this.shipBatch.destroy()
        this.markerBatch.destroy()
        this.bloomBatch.destroy()
        this.shotBatch.destroy()
        this.targetBatch.destroy()
        for (const batch of this.turretBatches.values()) batch.destroy()
        this.discMesh.destroy()
        for (const mesh of this.turretMeshes.values()) mesh.destroy()
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
