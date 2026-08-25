import { buildShip, findShip, SHIPS } from "../../assets/ships"
import { Ship } from "../../game/ship"
import { shipFromText, shipToText } from "../../game/shipJson"
import { Camera, type Vec2 } from "../../render/camera"
import { Color } from "../../render/color"
import { emissiveSources, spillOnto } from "../../game/emissiveSpill"
import { reachedCells, wiresFrom } from "../../game/powerNetwork"
import type { Frame } from "../../render/frame"
import type { Pipeline } from "../../render/webgpu/pipeline"
import { canPlace, componentById, componentsOfKind, kindOf, maxLevel, type ComponentKind } from "../../render/grid/components"
import { cellKey, type Cell } from "../../render/grid/grid"
import { SHIP_LAYERS, type ShipLayer } from "../../render/grid/layers"
import { appendShape, carriedTurns, shapeCovers, turnCount, type BlockShape } from "../../render/grid/shapes"
import { bestThrusterFacing, canClearLayer, canEraseAt, canPlaceAt, nextFacing, thrusterFacings } from "../../render/grid/shipLegality"
import { turnSignOf } from "../../game/physics"
import { DEFAULT_SHADING, Light, LightField } from "../../game/lighting"
import { LightBinding } from "../../render/lighting"
import { InstanceBatch } from "../../render/webgpu/instance"
import { DynamicMesh, Mesh, MeshBuilder } from "../../render/mesh"
import { appendTriangleOutline, thickenSegments } from "../../render/grid/gridOutline"
import type { InputService } from "../../input/service"
import { actionsIn, keysFor, specOf, type ActionId } from "../../input/actions"
import { countKinds, structuralIssues, type Issue, type KindCounts } from "../../game/shipReadiness"
import { costByKind, shipCost, type PerKind } from "../../game/shipCost"
import type { SceneContext, SceneInstance } from "../../render/scene"
import type { ActionsOf, SearchColumn, SettingsSchema, ValuesOf } from "../../settings/settings"
import {
    appendBlock, appendEmissiveBloom, appendLayer, blockCovers, displayBlock, type BlockLike,
} from "../../render/grid/blockDraw"
import { layerFor, loadBrush, saveBrush, type Brush, type BrushTool } from "../../render/grid/brush"
import { DRAWN_SHAPES } from "../../render/grid/palette"
import type { DevSceneDefinition } from "../DevScene"
import { downloadText, uploadText } from "../../download"
import { sendShip, shipOf, takeHandoff } from "../handoff"

/**
 * White, because the hover outline draws through the inverting pipeline.
 *
 * There src * (1 - dst) is the whole result, so only pure white comes out as a
 * true negative of the hull underneath - anything else is a tint of one.
 */
const HOVER_COLOR = Color.from("#ffffff")
const BLOCKED_COLOR = Color.from("#ff5a5a")

/** What the destroy tool outlines a block it would actually remove in. */
const DELETE_COLOR = Color.from("#ff9b3d")
const MARK_COLOR = Color.from("#7fe0ff")
const MASS_COLOR = Color.from("#ff8c1a")
const SELECTED_COLOR = Color.from("#00e5ff")


const HIGHLIGHT_COLOR = Color.from("#ffe14d")

/** How far the ghost is washed out. 0 is solid, 1 is invisible. */
const GHOST_FADE = 0.72

/**
 * How far a dimmed layer is washed toward the background.
 *
 * 0.85 leaves roughly the 15% of the original colour the button promises. There
 * is no alpha in the vertex format, but the *instance* carries one - so a dimmed
 * layer is drawn blended rather than washed toward the background. That is the
 * difference between seeing through a plate and merely seeing a paler plate.
 */
const DIM_ALPHA = 0.35

/**
 * How far a dimmed *marker* is washed toward the background.
 *
 * Still a mix rather than an alpha, and rightly so: a marker is a mark about the
 * ship rather than part of it, drawn flat over everything through the plain
 * pipeline. There is nothing underneath it worth seeing through to.
 */
const MARKER_DIM_FADE = 0.85

/** How strongly a protected block is tinted red. */
const PROTECTED_TINT = 0.45
const PROTECTED_COLOR = Color.from("#ff3b3b")

/**
 * The border round a steering engine, by the way it turns the ship.
 *
 * A border rather than a wash over the cell: the thing being marked is a nozzle
 * with art on it, and a fill covers exactly what you were trying to look at.
 *
 * Which colour means which is arbitrary; that it matches `Controls.turn` is not.
 * Green is the engine Q fires and blue the one E fires, taken from the same sign
 * the allocator matches on, so the marks cannot disagree with the flight sim.
 */
const TURN_LEFT_COLOR = Color.from("#3bff6f")
const TURN_RIGHT_COLOR = Color.from("#3b9bff")


/** How long a refusal stays on screen before it dismisses itself, in seconds. */
const NOTICE_SECONDS = 5
const BACKGROUND = Color.rgb(0.05, 0.05, 0.07)

/** This scene's own id, for a handoff that has to name where it came from. */
const SCENE_ID = "ship-builder"

const CELL = 32

/**
 * How wide every marker outline is drawn, in world units.
 *
 * Geometry rather than a line width, because WebGPU has none - see
 * thickenSegments. Measured against the cell, so an outline keeps its weight
 * relative to the blocks it is drawn around however far the camera is zoomed.
 */
const OUTLINE_WIDTH = CELL * 0.03

/*~~~ Power wires ~~~*/

/**
 * The two passes a wire is drawn in: a wide dim one under a narrow bright one.
 *
 * Additive, so where they overlap they sum to a hot core inside a soft halo -
 * which is what makes a line read as glowing rather than as merely coloured. One
 * pass at any width just looks like a line.
 */
const WIRE_HALO_WIDTH = CELL * 0.18
const WIRE_CORE_WIDTH = CELL * 0.05

/** Trunk between two sources, and the last hop to something that spends. */
const WIRE_RELAY_COLOR = Color.from("#39d7ff")
const WIRE_DRAW_COLOR = Color.from("#8bff6a")

/** How much of its colour the halo carries. Low: it is spill, not the wire. */
const WIRE_HALO_STRENGTH = 0.28

/**
 * A pulse of charge running down a wire: how fast, how far apart, how big.
 *
 * Spaced by distance rather than one per wire, so a long run carries several and
 * a short hop carries one - which is what makes the flow read as a rate rather
 * than as a decoration. Speed is world units a second, so every run moves at the
 * same pace whatever its length.
 */
const PULSE_SPEED = CELL * 3.2
const PULSE_SPACING = CELL * 1.4
const PULSE_SIZE = CELL * 0.11

/** How much brighter a pulse is than the wire it rides. */
const PULSE_STRENGTH = 1.6

/*~~~ Reach ~~~*/

/**
 * The wash over cells a selected source reaches, and the edge where it stops.
 *
 * Very faint inside: the point is to read the *extent* at a glance without
 * losing the ship under it, so the boundary carries the information and the fill
 * only says which side of it you are on.
 */
const REACH_FILL_STRENGTH = 0.06
const REACH_EDGE_STRENGTH = 0.5
const REACH_EDGE_WIDTH = CELL * 0.05
const REACH_COLOR = Color.from("#39d7ff")

/** The four neighbours of a cell, for finding where a region stops. */
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

/**
 * A solid node on every part that spends power.
 *
 * Only on what the selection actually feeds, and only while something is
 * selected. A node on every consumer at all times said "this needs power",
 * which is true of all of them and so told you nothing; a node on the ones a
 * particular source reaches says which, which is the question being asked.
 *
 * Batteries get one too. Power arriving at a battery is power arriving, and one
 * colour for both says so - the wire's own colour is already what distinguishes
 * carrying it from spending it.
 *
 * It is also what the last hop of a wire lands on, so a run terminates at
 * something rather than in the middle of a plate.
 *
 * Solid rather than additive: this is a fixture on the ship, not light running
 * through it, and glowing would put it in the same language as the wires.
 */
const NODE_SIZE = CELL * 0.13
const NODE_COLOR = Color.from("#8bff6a")

/** A square centred on a point, as two triangles of the shared vertex format. */
function appendDot(
    out: number[],
    x: number,
    y: number,
    half: number,
    r: number,
    g: number,
    b: number,
): void {
    out.push(
        x - half, y - half, r, g, b,
        x + half, y - half, r, g, b,
        x + half, y + half, r, g, b,
        x - half, y - half, r, g, b,
        x + half, y + half, r, g, b,
        x - half, y + half, r, g, b,
    )
}

/** What a DynamicMesh is written with to say it holds nothing this frame. */
const EMPTY_MESH = new Float32Array(0)

/**
 * Where the ship waits out the reload that saving causes.
 *
 * Writing into assets/ships changes a file Vite's glob is watching, so the page
 * reloads - which is what makes the saved ship appear in the picker, and would
 * otherwise throw away the session that just saved it. Session storage rather
 * than the handoff, because the handoff is module state and the reload is
 * exactly what clears it.
 */
const RESTORE_KEY = "space-game-builder-restore"
/** How far past the hull to offer cells. Two, so a thruster's reach stays visible. */
const MARGIN = 2

const SHIP_COLUMNS: readonly SearchColumn[] = [
    { header: "Ship", cell: (id) => findShip(id)?.name ?? id },
    { header: "Size", cell: (id) => sizeLabel(findShip(id)) },
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
        // Not carried across a reload: the builder only loads a ship when this
        // *changes*, so a remembered id left the panel naming a ship that was
        // never opened - and picking it again did nothing, because it had not
        // changed
        transient: true,
        // Past the default 8: the result box scrolls, so an unfiltered list
        // showing every ship beats one that silently stops at the eighth
        limit: 50,
    },

    actionsSep: { type: "separator", label: "Actions" },
    
    resolution: { type: "range", label: "Resolution", default: 1, min: 0.05, max: 1, step: 0.05 },
    test:       { type: "button", label: "Test Flight" },
    save:       { type: "button", label: "Update Saved Ship" },
    download:   { type: "button", label: "Download Ship" },
    upload:     { type: "button", label: "Upload Ship" },
} as const satisfies SettingsSchema

type EditorValues = ValuesOf<typeof SETTINGS>
type Snapshot = Record<ShipLayer, Cell[]>

/** "Scythe Ship" -> "scythe-ship", so a downloaded file can drop straight into assets/ships. */
function slug(name: string): string {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return clean === "" ? "untitled" : clean
}

/** The next entry in a list, wrapping at both ends. */
function stepThrough<T>(list: readonly T[], current: T, by: number): T {
    const index = list.indexOf(current)
    return list[(index + by + list.length) % list.length]!
}

/** A ship's footprint as "columns x rows", or "-" for one with no blocks at all. */
function sizeLabel(ship: Ship | undefined): string {
    const bounds = ship?.bounds
    if (!bounds) return "-"

    return `${bounds.maxCol - bounds.minCol + 1}x${bounds.maxRow - bounds.minRow + 1}`
}

/** What the info panel shows about whichever cell was clicked last. */
export interface SelectedCell {
    col: number
    row: number
    layer: ShipLayer
    shape: BlockShape
    /** A registry id. */
    type: string
    /** The type's display name, so the panel does not repeat the lookup. */
    typeName: string
    level: number
    maxLevel: number
    turns: number
    mirrored: boolean
    facing: number
    /** Thrusters only. Meaningless on anything else, which is why the panel asks. */
    steering: boolean
    color: string
    hitPoints: number
    mass: number
}

/**
 * How much of a layer is drawn.
 *
 * Three states rather than a checkbox: "dim" is what you want while building on
 * top of a hull you need to see but not read, and it is one click away from
 * either of the other two.
 */
export const LAYER_VIEWS = ["full", "dim", "hidden"] as const
export type LayerView = (typeof LAYER_VIEWS)[number]

/**
 * Everything the visibility panel can switch, ship layers plus the overlays.
 *
 * `markers` is not a layer of the ship - nothing is stored in it and nothing can
 * be built on it. It is every mark the editor draws *about* the ship: the
 * center of mass, the legal-placement crosses, the protected-block wash, and the
 * selection and palette-highlight boxes. Grouping them under one switch is the
 * only way to see a finished hull with nothing on top of it.
 */
export type ViewLayer = ShipLayer | "markers"

/**
 * The visibility rows, top of the stack first.
 *
 * Reversed against SHIP_LAYERS deliberately: that array is draw order, bottom
 * up, and a panel that lists the topmost thing last reads upside down next to
 * the ship it describes. Markers lead because they draw over everything.
 */
export const VIEW_LAYERS: readonly ViewLayer[] = ["markers", ...[...SHIP_LAYERS].reverse()]

/** The running totals the info panel reads. */
export interface ShipInfo {
    name: string
    creator: string
    mass: number
    blocks: number
    /** Footprint as columns by rows, both 0 for an empty ship. */
    width: number
    height: number
    perLayer: Record<ShipLayer, number>
    /** How many of each category, for the download dialog's summary. */
    perKind: KindCounts
    /** What the ship costs to build. Hull and cosmetics are free. */
    cost: number
    /** The same total per category, for the dialog's breakdown. */
    costPerKind: PerKind
    /** Everything standing between this ship and a file. Empty means ready. */
    issues: Issue[]
}

/** What the brush would place, as the shape of thing blockDraw knows how to draw. */
function ghostCell(brush: Brush, facing: number): BlockLike {
    return {
        shape: brush.shape,
        turns: brush.turns,
        mirrored: brush.mirrored,
        type: brush.type,
        level: brush.level,
        facing,
        color: Color.from(brush.color),
        // Empty means "leave the art's accent alone", the same as a placed cell
        accentColor: brush.accentColor === "" ? null : Color.from(brush.accentColor),
    }
}

/**
 * The emission a brush places with.
 *
 * Only structure takes the player's slider. A component's glow belongs to the
 * piece - a thruster's nozzle is drawn hot by whoever drew it - so letting the
 * brush set one would mean the same part glowed differently depending on where
 * the slider happened to be left. Enforced here rather than only in the panel,
 * so no other caller can reintroduce it.
 */
function emissionFor(brush: Brush): number {
    return kindOf(brush.type) === "hull" ? brush.emission : 0
}

/**
 * The category each first-letter shortcut picks.
 *
 * A list rather than six ifs, and paired here rather than derived from the kind
 * names: the action ids are what a rebinding panel edits, so they have to be
 * real ids and not strings assembled at runtime.
 */
const TOOL_KEYS: readonly (readonly [ActionId, BrushTool])[] = [
    ["builder.toolBuild", "build"],
    ["builder.toolDestroy", "destroy"],
    ["builder.toolSelect", "select"],
]

const PICK_KEYS: readonly (readonly [ActionId, ComponentKind])[] = [
    ["builder.pickHull", "hull"],
    ["builder.pickThruster", "thruster"],
    ["builder.pickCargo", "cargo"],
    ["builder.pickGenerator", "generator"],
    ["builder.pickProjector", "projector"],
    ["builder.pickWeapon", "weapon"],
]

/** A plus sign, so a marker stays visible against the hull behind it. */
function appendCross(builder: MeshBuilder, x: number, y: number, size: number, color: Color): void {
    const arm = size / 2
    const thick = Math.max(size / 8, 0.5)

    builder.quad(x - arm, y - thick / 2, size, thick, color)
    builder.quad(x - thick / 2, y - arm, thick, size, color)
}

/** One cell's border, appended to a shared line buffer rather than its own mesh. */
function appendCellBorder(
    out: number[], col: number, row: number, origin: Vec2, r: number, g: number, b: number,
): void {
    const x = (col - origin.x) * CELL
    const y = (row - origin.y) * CELL

    const box = [
        x, y, x + CELL, y,
        x + CELL, y, x + CELL, y + CELL,
        x + CELL, y + CELL, x, y + CELL,
        x, y + CELL, x, y,
    ]

    for (let i = 0; i < box.length; i += 2) out.push(box[i]!, box[i + 1]!, r, g, b)
}

/** A small cross at a cell's center. Line geometry, so it shares the line pipeline. */
function appendMark(out: number[], col: number, row: number, origin: Vec2, color: Color): void {
    const x = (col - origin.x) * CELL + CELL / 2
    const y = (row - origin.y) * CELL + CELL / 2
    const arm = CELL * 0.22
    const { r, g, b } = color

    out.push(x - arm, y, r, g, b, x + arm, y, r, g, b)
    out.push(x, y - arm, r, g, b, x, y + arm, r, g, b)
}


class ShipBuilder implements SceneInstance<EditorValues> {
    private readonly context: SceneContext
    private readonly input: InputService
    private readonly camera = new Camera()

    // The creator is stated here because the dev panel no longer holds it: with
    // the field gone, a blank ship would otherwise open as Ship's own "Unknown"
    private ship = new Ship("untitled", "New Ship", "Sandman")

    // Meshes
    private readonly meshes = new Map<ShipLayer, Mesh>()
    private readonly marks: DynamicMesh
    private marksKey = ""
    /** Red wash over blocks the destroy tool would refuse. */
    private protectedBoxes: Mesh | null = null
    private protectedKey = ""
    /** Green and blue borders round the engines that turn the ship. */
    private readonly steeringBoxes: DynamicMesh
    private steeringKey = ""
    private readonly hover: DynamicMesh
    /**
     * Whether the hover outline is the inverting one.
     *
     * A legal cell draws white through the invert pipeline, so the marker is the
     * negative of whatever hull it is over and cannot be lost against it. A
     * refusal keeps its flat red: that colour *is* the message, and inverting it
     * would leave the refusal looking like any other outline.
     */
    private hoverLegal = true
    private readonly ghost: DynamicMesh
    /** The center-of-mass cross, rebuilt whenever the geometry moves it. */
    private massMark: Mesh | null = null

    /**
     * The cell the pointer last pressed on, whether or not anything is there.
     *
     * Kept as coordinates rather than as a Cell so it survives an edit: upgrading
     * a block replaces the object in the grid, and a held reference would go
     * stale the moment the info panel changed anything.
     */
    /** True while the panel has a dialog open over everything. */
    private modal = false

    /*~~~ Lighting preview ~~~*/
    /** Off by default: building wants flat, honest colours, not a lit render. */
    private lit = false
    private readonly litBatch: InstanceBatch
    /** The same identity instance, carrying the alpha a dimmed layer draws at. */
    private readonly dimBatch: InstanceBatch
    private readonly lights: LightBinding
    private readonly field = new LightField()
    private readonly sun = new Light({ position: { x: 0, y: 0 } })
    /** Distance to the outermost cell, which is what the shading fades across. */
    private shadingReach = 1
    /** The halo around cells that light themselves. Only drawn with the preview. */
    private bloomMesh: Mesh | null = null

    private selected: { col: number; row: number; layer: ShipLayer } | null = null
    private selectionKey = ""
    private readonly selectedBox: DynamicMesh

    /** The palette swatch the pointer is over, as hex, or null when it is not. */
    private highlight: string | null = null
    private highlightKey = ""
    private readonly highlightBoxes: DynamicMesh
    /** Where the selected part's power comes from, or goes to. Empty when nothing is selected. */
    private readonly powerWires: DynamicMesh
    private wiresKey = ""
    /**
     * The runs the pulses ride, kept because they are redrawn every frame.
     *
     * The wires themselves are a static mesh rebuilt only on selection; only the
     * charge moving along them changes per frame, and rebuilding the wires to
     * animate it would be rewriting a hundred vertices to move six.
     */
    private wireRuns: { from: Vec2; to: Vec2; ink: Color }[] = []
    private readonly wirePulses: DynamicMesh
    /** Which cells the selected source reaches. Empty for anything else. */
    private readonly reachMark: DynamicMesh
    /** A point on each part the selection feeds. Empty with nothing selected. */
    private readonly drawNodes: DynamicMesh
    /** How far the leading pulse has travelled down its run, in world units. */
    private pulsePhase = 0

    /**
     * The one brush there is.
     *
     * The panel renders this and asks for changes; it keeps no copy of its own.
     * That is what stops the two drifting - there is nothing to drift from.
     */
    private brush: Brush = loadBrush()
    private brushSaveTimer: ReturnType<typeof setTimeout> | undefined

    private builtRevision = -1
    private hoverKey = ""
    private settings: EditorValues | null = null

    // Compared against each field's previous value rather than against the ship:
    // loading a file changes the ship, and comparing to the ship would let the
    // stale contents of the Name box overwrite it on the very next frame
    private lastShipId: string | null = null

    // The origin never moves. The viewer recenters on mass, which in an editor
    // would shift everything already drawn every time you place a block.
    private readonly origin: Vec2 = { x: 0, y: 0 }

    private readonly undoStack: Snapshot[] = []
    private readonly redoStack: Snapshot[] = []

    /** Whether this stroke has already taken its snapshot. Reset on every press. */
    private strokeEdited = false

    /** The refusal currently on screen, so an unchanged one is not republished. */
    private notice: string | null = null
    /** Seconds the current refusal has been up, which is what dismisses it. */
    private noticeAge = 0

    /** How much of each layer is drawn. A view setting, so it is not on the brush. */
    private layerView: Record<ViewLayer, LayerView> = {
        markers: "full",
        hull: "full",
        components: "full",
        cosmetic: "full",
    }

    /**
     * Everything a button can ask for, by name.
     *
     * The dev panel's settings buttons and the builder UI's toolbar both go
     * through this, so there is one implementation of "undo" rather than one per
     * surface that can invoke it.
     */
    private readonly commands: Record<string, () => void> = {
        undo: () => this.undo(),
        redo: () => this.redo(),
        clearLayer: () => {
            const legal = canClearLayer(this.ship, this.brush.layer)
            if (!legal.ok) return this.notify(legal.reason ?? "that layer cannot be cleared")

            this.mutate(() => this.ship.layers[this.brush.layer].clear())
            this.notify(null)
        },
        clearAll: () => {
            this.mutate(() => { for (const grid of this.ship.layersOf()) grid.clear() })
            this.notify(null)
        },
        save: () => void this.saveInPlace(),
        download: () => downloadText(`${this.ship.id}.json`, shipToText(this.ship)),
        upload: () => uploadText((text) => this.load(text)),
        test: () => this.flyIt(),
    }

    readonly actions: Record<ActionsOf<typeof SETTINGS>, () => void> = {
        test: () => this.commands.test!(),
        save: () => this.commands.save!(),
        download: () => this.commands.download!(),
        upload: () => this.commands.upload!(),
    }

    /**
     * A patch from the panel, never a whole brush.
     *
     * The UI can set a color but does not own one - it sends the field it changed
     * and the scene decides what the brush becomes. A whole-object message would
     * let a panel built against an older Brush silently drop fields it never
     * heard of.
     */
    receive(key: string, value: unknown): void {
        if (key === "brush") {
            this.patchBrush(value as Partial<Brush>)
            return
        }

        // A named button rather than a value, so the UI needs no knowledge of what
        // undo does - only that the scene owns one
        if (key === "action") {
            this.commands[value as string]?.()
            return
        }

        // Signed, so one message covers both the up and down arrows in the panel
        if (key === "upgrade") {
            this.changeSelectedLevel(value as number)
            return
        }

        // Thrusters only, and the scene checks that rather than trusting the
        // panel to have hidden the button
        if (key === "steering") {
            this.setSelectedSteering(value as boolean)
            return
        }

        // Raised while a dialog is up, so the shortcuts underneath stop answering
        if (key === "modal") {
            this.modal = value === true
            return
        }

        if (key === "lit") {
            this.lit = value === true
            this.context.publish("lit", this.lit)
            return
        }

        if (key === "identity") {
            this.rename(value as { name?: string; creator?: string })
            return
        }

        // A patch, like the brush: the panel changes one layer at a time and has
        // no business restating the other two
        if (key === "layerView") {
            this.layerView = { ...this.layerView, ...(value as Partial<Record<ViewLayer, LayerView>>) }
            this.context.publish("layerView", this.layerView)

            // A selection that has just been hidden has to go with it, or the
            // panel keeps describing a block nobody can point at any more
            if (this.selected && this.layerView[this.selected.layer] === "hidden") {
                this.selected = null
            }

            // Nothing in the ship changed, so the geometry revision would not
            // notice - the meshes have to be asked to rebuild
            this.builtRevision = -1
            return
        }

        // Null clears it: the panel sends on enter and again on leave, so the
        // scene never has to guess when a hover ended
        if (key === "highlight") this.highlight = (value as string | null) ?? null
    }

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        this.input = context.input

        // One instance, because the builder draws one ship and never moves it -
        // the lit pipeline is instanced, so even a still hull needs a transform
        this.litBatch = InstanceBatch.create(gpu, context.renderer.instanceLayout, 1, "builder ship")
        this.dimBatch = InstanceBatch.create(gpu, context.renderer.instanceLayout, 1, "builder dim")
        this.lights = LightBinding.create(gpu, 1)
        this.field.add(this.sun)

        this.steeringBoxes = DynamicMesh.create(gpu, "steering engines")
        this.marks = DynamicMesh.create(gpu, "legal cells")
        this.hover = DynamicMesh.create(gpu, "hover")
        this.ghost = DynamicMesh.create(gpu, "ghost")
        this.selectedBox = DynamicMesh.create(gpu, "selected")
        this.highlightBoxes = DynamicMesh.create(gpu, "colour highlight")
        this.powerWires = DynamicMesh.create(gpu, "power wires")
        this.wirePulses = DynamicMesh.create(gpu, "power pulses")
        this.reachMark = DynamicMesh.create(gpu, "power reach")
        this.drawNodes = DynamicMesh.create(gpu, "power nodes")

        this.camera.zoom = 1

        // Published from the constructor, not on the first frame: load() clears the
        // channel before create() runs, so this is the first thing the panel sees
        this.publishBrush()
        this.context.publish("layerView", this.layerView)
        this.context.publish("lit", this.lit)
        this.publishKeyGuide()

        // Whatever came back from a test flight, which is the ship that left here
        // - unsaved edits included, since nothing wrote it to a file in between
        const returning = takeHandoff()
        if (returning) this.replaceShip(shipOf(returning), true)
        else this.restoreAfterSave()
    }

    update(dt: number, settings: EditorValues): void {
        this.settings = settings
        this.ageNotice(dt)
        // Cheap to set every frame: the setter early-returns when unchanged, and
        // fitCamera already reads gpu.width, so the camera refits itself
        this.context.gpu.resolutionScale = settings.resolution
        this.syncIdentity(settings)

        this.readShortcuts()
        this.rebuildPulses(dt)

        const [col, row] = this.getGridPositionFromMouse()

        // A snapshot per stroke, not per cell, so one undo reverts a whole drag -
        // and not until an edit actually lands, so a refused or empty click costs
        // nothing
        if (this.input.pointer.pressed()) {
            this.strokeEdited = false

            // Only the select tool selects. Destroy is about removing what is
            // under the cursor, and leaving a selection behind afterwards points
            // the info panel at a block that no longer exists.
            if (this.input.pointer.over && this.brush.tool === "select") this.selectAt(col, row)
        }
        // pressed() as well as isDown(): a click whose press and release both land
        // between two frames is never "down" when a frame reads it, so at a high
        // frame rate a quick tap would place nothing at all
        const painting = this.input.pointer.pressed() || this.input.pointer.isDown()
        if (painting && this.input.pointer.over) this.apply(col, row)

        // Divide by zoom so movement ammount is the same no matter the zoom
        if (this.input.pointer.isDown("middle") || this.input.pointer.isDown("right")) {
            this.camera.position.x -= this.input.pointer.deltaX / this.camera.zoom
            this.camera.position.y -= this.input.pointer.deltaY / this.camera.zoom
        }

        // Zoom
        if (this.input.pointer.wheel !== 0) {
            this.camera.zoom = Math.min(8, Math.max(0.1, this.camera.zoom * 0.999 ** this.input.pointer.wheel))
        }

        // If the ship changed, update it
        if (this.ship.geometryRevision !== this.builtRevision) this.rebuildMeshes()

        this.rebuildMarks()
        this.rebuildProtected()
        this.rebuildSteering()
        this.rebuildCursor(col, row)
        this.rebuildHighlight()
        this.rebuildWires()
        this.publishSelection()
    }

    render(frame: Frame): void {
        const gpu = this.context.gpu
        const settings = this.settings
        if (!settings) return

        const { camera, mesh: meshPipeline, meshLines: linePipeline } = this.context.renderer
        camera.upload(this.camera, gpu.width, gpu.height)

        // The ship first, lit or flat. The flat view goes through the instanced
        // pipeline rather than the plain mesh one for a single reason: mesh2d
        // writes an alpha of 1 and can never be seen through, and dimming a layer
        // has to work the same way in both views.
        if (this.lit) this.drawLit(frame)
        else {
            this.litBatch.begin().add(0, 0, 0, 1, 1, 1, 1, 1)
            this.dimBatch.begin().add(0, 0, 0, 1, 1, 1, 1, DIM_ALPHA)

            this.drawLayers(frame, this.context.renderer.instanced, this.context.renderer.instancedAlpha)
        }

        // Everything from here is a mark *about* the ship rather than the ship, so
        // it is never shaded - a shadow falling across the legal-cell marks would
        // make them harder to read for no gain
        frame.setPipeline(meshPipeline).setBindGroup(0, camera.group)

        // Over the ship it describes, under the ghost and the mass mark - it is a
        // wash on the blocks, not a thing in its own right
        const markers = !this.markersHidden
        if (markers && this.protectedBoxes) this.protectedBoxes.draw(frame)

        // The ghost stays: it is where the cursor is, not a mark about the ship,
        // and losing it would make the build tool feel broken
        this.ghost.draw(frame)
        if (markers && this.massMark) this.massMark.draw(frame)

        // Outlines are quads now rather than a line list, so they draw through the
        // solid pipeline. Still last, because they are the one thing that has to
        // stay readable over a finished hull.
        if (this.hoverLegal) {
            frame.setPipeline(this.context.renderer.meshInvert).setBindGroup(0, camera.group)
            this.hover.draw(frame)
            frame.setPipeline(meshPipeline).setBindGroup(0, camera.group)
        } else {
            this.hover.draw(frame)
        }

        if (markers) this.steeringBoxes.draw(frame)
        if (markers) this.highlightBoxes.draw(frame)

        // Additive and over the hull: a wire is light running through the ship,
        // and one hidden behind the plate it feeds would answer nothing
        if (markers) {
            frame.setPipeline(this.context.renderer.meshGlow).setBindGroup(0, camera.group)
            // Reach under the wires: it is the area they run through
            this.reachMark.draw(frame)
            this.powerWires.draw(frame)
            this.wirePulses.draw(frame)

            // Solid and last, so a wire terminates on a node rather than under it
            frame.setPipeline(meshPipeline).setBindGroup(0, camera.group)
            this.drawNodes.draw(frame)
        }
        if (markers) this.selectedBox.draw(frame)

        // The legal-cell marks are still lines: they are crosses in open space
        // rather than outlines round anything
        frame.setPipeline(linePipeline).setBindGroup(0, camera.group)
        if (markers) this.marks.draw(frame)

        this.context.stats.set("blocks", this.ship.layersOf().reduce((sum, g) => sum + g.size, 0))
        this.context.stats.set("undo depth", this.undoStack.length)
    }

    private getGridPositionFromMouse(): [col: number, row: number] {
        const { col, row } = this.cursorCell()
        return [col, row]
    }

    /**
     * The cell under the pointer, and where in it the pointer is.
     *
     * The fraction matters for picking: a half block leaves half its cell empty,
     * and which half the cursor is over decides whether it hits that block or
     * whatever is drawn underneath.
     */
    private cursorCell(): { col: number; row: number; u: number; v: number } {
        const world = this.camera.screenToWorld(this.input.pointer.x, this.input.pointer.y)

        const x = world.x / CELL + this.origin.x
        const y = world.y / CELL + this.origin.y
        const col = Math.floor(x)
        const row = Math.floor(y)

        return { col, row, u: x - col, v: y - row }
    }

    /**
     * Sends the ship as it stands to the flight sim, and asks to go there.
     *
     * The live ship rather than the one the picker names: the whole point is to
     * try what is on screen, which usually has never been saved. The flight scene
     * hands the same ship back on the way home, so an unsaved edit survives the
     * round trip.
     */
    private flyIt(): void {
        sendShip(this.ship, SCENE_ID)
        this.context.publish("goto", "ship-flight")
    }

    /**
     * The builder's shortcuts, as the player has them bound.
     *
     * Read from the live bindings rather than written out in the panel, so a
     * rebinding shows up in the guide and a card can never claim a key that does
     * something else. Published once on load: bindings do not change mid-scene.
     */
    private publishKeyGuide(): void {
        const bindings = this.input.table

        const guide = actionsIn("builder").map((action) => ({
            keys: keysFor(action, bindings.codesFor(action)),
            does: specOf(action).label,
        }))

        this.context.publish("keyGuide", guide)
    }

    /**
     * Renames the ship, from the panel's own fields.
     *
     * The ship owns its name now rather than the settings bag: the builder panel
     * has the fields, and a second copy in the dev panel was one more thing that
     * could disagree with them.
     */
    private rename(patch: { name?: string; creator?: string }): void {
        if (patch.name !== undefined) {
            this.ship.name = patch.name
            this.ship.id = slug(patch.name)
        }

        if (patch.creator !== undefined) this.ship.creator = patch.creator

        // Republished here rather than waiting on a rebuild: a rename moves no
        // geometry, so the revision does not notice, and the panel would keep
        // showing the name from before the edit
        this.publishShipInfo()
    }

    /** Loads whatever ship the picker names, when that changes. */
    private syncIdentity(settings: EditorValues): void {
        // The first frame only records what the picker says. Opening the scene
        // should leave the blank ship alone; picking from the list is what loads one.
        if (this.lastShipId === null) this.lastShipId = settings.ship
        else if (settings.ship !== this.lastShipId) {
            this.lastShipId = settings.ship
            this.replaceShip(buildShip(settings.ship))
        }
    }

    dispose(): void {
        // The scale lives on the GPU, not on the scene, so leaving it set would
        // follow the user into every other scene they switch to
        this.context.gpu.resolutionScale = 1

        clearTimeout(this.brushSaveTimer)

        for (const mesh of this.meshes.values()) mesh.destroy()
        this.marks.destroy()
        this.protectedBoxes?.destroy()
        this.steeringBoxes.destroy()
        this.litBatch.destroy()
        this.dimBatch.destroy()
        this.lights.destroy()
        this.bloomMesh?.destroy()
        this.hover.destroy()
        this.ghost.destroy()
        this.massMark?.destroy()
        this.selectedBox.destroy()
        this.highlightBoxes.destroy()
        this.powerWires.destroy()
        this.wirePulses.destroy()
        this.reachMark.destroy()
        this.drawNodes.destroy()
    }

    /*~~~ Brush ~~~*/

    /** Hands the panel the new brush and schedules the write to storage. */
    /**
     * The keyboard's brush shortcuts.
     *
     * Read here rather than in the panel, because the scene is what owns the brush:
     * the panel used to handle these on a window listener and send a patch back,
     * which meant the shortcuts were bound to `event.key` letters and broke on any
     * layout that does not put R where QWERTY does.
     */
    private readShortcuts(): void {
        // A dialog is modal: its backdrop already keeps the pointer off the grid,
        // and the keyboard has no backdrop, so it is stopped here instead
        if (this.modal) return

        const input = this.input

        if (input.pressed("builder.rotate")) this.rotateBrush()
        if (input.pressed("builder.mirror")) this.patchBrush({ mirrored: !this.brush.mirrored })

        // Cycles 1..max and wraps, so one key reaches every level of the type
        if (input.pressed("builder.cycleLevel")) {
            this.patchBrush({ level: (this.brush.level % maxLevel(this.brush.type)) + 1 })
        }

        if (input.pressed("builder.prevShape")) this.stepShape(-1)
        if (input.pressed("builder.nextShape")) this.stepShape(1)

        // SHIP_LAYERS is bottom-up and the panel lists it top-down, so "up" is a
        // step *forward* through the array - toward cosmetic, which is the row
        // above components in the panel someone is looking at
        if (input.pressed("builder.layerUp")) this.stepLayer(1)
        if (input.pressed("builder.layerDown")) this.stepLayer(-1)

        if (input.pressed("builder.undo")) this.undo()
        if (input.pressed("builder.redo")) this.redo()

        for (const [action, tool] of TOOL_KEYS) {
            if (input.pressed(action)) this.pickTool(tool)
        }

        for (const [action, kind] of PICK_KEYS) {
            if (input.pressed(action)) this.pickKind(kind)
        }
    }

    /**
     * Switches tool, taking the brush somewhere it can work.
     *
     * The same move the panel's tool buttons make: erase and select can sit on a
     * layer the brush's type cannot build on, so coming back to build has to find
     * a legal layer or the first click would be refused with no explanation.
     */
    private pickTool(tool: BrushTool): void {
        if (this.brush.tool === tool) return

        this.patchBrush({
            tool,
            layer: tool === "build" ? layerFor(this.brush.type, this.brush.layer) : this.brush.layer,
        })
    }

    /**
     * Switches the brush to a category's first model.
     *
     * The same move the panel's category buttons make, and it has to be: a
     * shortcut that left the brush on a layer its type cannot go on would place
     * nothing and explain nothing.
     */
    private pickKind(kind: ComponentKind): void {
        const type = componentsOfKind(kind)[0]?.id
        if (!type || type === this.brush.type) return

        const layers = SHIP_LAYERS.filter((layer) => canPlace(type, layer))
        const layer = layers.includes(this.brush.layer) ? this.brush.layer : layers[0] ?? this.brush.layer

        this.patchBrush({ type, layer, level: Math.min(this.brush.level, maxLevel(type)), tool: "build" })
    }

    /**
     * One step of orientation.
     *
     * A component draws as its own art or as a hexagon, so turning the art means
     * nothing - what points somewhere is its facing. Structure has no facing, so
     * it turns instead.
     */
    private rotateBrush(): void {
        const brush = this.brush

        if (kindOf(brush.type) === "thruster") {
            this.patchBrush({ facing: this.nextThrusterFacing() })
            return
        }

        if (kindOf(brush.type) !== "hull") {
            this.patchBrush({ facing: (brush.facing + 1) % 4 })
            return
        }

        this.patchBrush({ turns: (brush.turns + 1) % turnCount(brush.shape) })
    }

    private stepShape(by: number): void {
        const shape = stepThrough(DRAWN_SHAPES, this.brush.shape, by)

        // Back to paint, as picking a shape in the tray does: choosing one while the
        // brush sits on erase would light nothing up and do nothing. The layer comes
        // along for the same reason - erase may have left it somewhere it cannot build.
        this.patchBrush({
            shape,
            turns: carriedTurns(this.brush.shape, shape, this.brush.turns),
            tool: "build",
            layer: layerFor(this.brush.type, this.brush.layer),
        })
    }

    private stepLayer(by: number): void {
        this.patchBrush({ layer: stepThrough(SHIP_LAYERS, this.brush.layer, by) })
    }

    /**
     * Changes the brush and tells the panel, whatever asked for the change.
     *
     * One path for the panel's controls and for the keyboard, because they are the
     * same gesture reached two ways - a shortcut that skipped the publish would
     * leave the tray showing a shape the brush no longer holds.
     */
    private patchBrush(patch: Partial<Brush>): void {
        this.brush = { ...this.brush, ...patch }
        this.publishBrush()
    }

    private publishBrush(): void {
        this.context.publish("brush", this.brush)

        // Debounced for the same reason settings are: dragging emission would
        // otherwise write localStorage on every pointer move
        clearTimeout(this.brushSaveTimer)
        const snapshot = this.brush
        this.brushSaveTimer = setTimeout(() => saveBrush(snapshot), 400)
    }

    /**
     * Boxes every cell painted in the hovered palette colour.
     *
     * Keyed on the colour and the geometry, so hovering along a row of swatches
     * rebuilds once per swatch rather than once per frame.
     */
    private rebuildHighlight(): void {
        const key = `${this.highlight ?? ""}|${this.ship.geometryRevision}|${this.layerView.markers}`
        if (key === this.highlightKey) return
        this.highlightKey = key

        this.highlightBoxes.write(EMPTY_MESH)
        if (!this.highlight) return

        const wanted = this.highlight.toLowerCase()
        const out: number[] = []
        const { r, g, b } = this.markerInk(HIGHLIGHT_COLOR)

        for (const grid of this.ship.layersOf()) {
            for (const cell of grid.list) {
                if (cell.color.hex.toLowerCase() !== wanted) continue
                appendCellBorder(out, cell.col, cell.row, this.origin, r, g, b)
            }
        }

        const thick: number[] = []
        thickenSegments(thick, out, OUTLINE_WIDTH)
        this.highlightBoxes.write(new Float32Array(thick))
    }

    /**
     * The wiring the selected part sits on, as glowing runs between cells.
     *
     * Rebuilt on the ship's plain revision rather than its geometry: moving a
     * battery one cell changes no triangles on the hull and would otherwise leave
     * the wires describing where it used to be.
     *
     * Nothing selected means nothing drawn. The wires answer "what does this
     * feed" and "where does this come from", and both questions need a subject.
     */
    private rebuildWires(): void {
        const at = this.selected
        const key = `${at ? `${at.col},${at.row}` : ""}|${this.ship.revision}|${this.layerView.markers}`
        if (key === this.wiresKey) return
        this.wiresKey = key

        this.powerWires.write(EMPTY_MESH)
        this.wirePulses.write(EMPTY_MESH)
        this.reachMark.write(EMPTY_MESH)
        this.drawNodes.write(EMPTY_MESH)
        this.wireRuns = []
        if (!at || this.layerView.markers === "hidden") return

        this.buildReachMark(at)

        const links = wiresFrom(this.ship, at.layer, at.col, at.row)
        if (links.length === 0) return

        const halo: number[] = []
        const core: number[] = []

        for (const link of links) {
            const ink = this.markerInk(link.relay ? WIRE_RELAY_COLOR : WIRE_DRAW_COLOR)
            const from = this.cellCentre(link.from.col, link.from.row)
            const to = this.cellCentre(link.to.col, link.to.row)

            this.wireRuns.push({ from, to, ink })

            core.push(from.x, from.y, ink.r, ink.g, ink.b, to.x, to.y, ink.r, ink.g, ink.b)
            halo.push(
                from.x, from.y, ink.r * WIRE_HALO_STRENGTH, ink.g * WIRE_HALO_STRENGTH, ink.b * WIRE_HALO_STRENGTH,
                to.x, to.y, ink.r * WIRE_HALO_STRENGTH, ink.g * WIRE_HALO_STRENGTH, ink.b * WIRE_HALO_STRENGTH,
            )
        }

        // From the links rather than from the ship, so a node can never mark
        // something the wires do not reach - the same rule the outlines follow by
        // being traced from the drawing code
        const nodes: number[] = []
        const marked = new Set<number>()
        const ink = this.markerInk(NODE_COLOR)

        // Every run's far end, relay or not: a battery is as much a place the
        // power arrives at as a thruster is, and marking only the last hop left
        // the things carrying it looking like bare junctions in the wire
        for (const link of links) {
            const key = cellKey(link.to.col, link.to.row)
            if (marked.has(key)) continue
            marked.add(key)

            const at = this.cellCentre(link.to.col, link.to.row)
            appendDot(nodes, at.x, at.y, NODE_SIZE, ink.r, ink.g, ink.b)
        }

        this.drawNodes.write(new Float32Array(nodes))

        // Halo first so the core lands on top of it; additive makes the overlap
        // the brightest part of the run
        const out: number[] = []
        thickenSegments(out, halo, WIRE_HALO_WIDTH)
        thickenSegments(out, core, WIRE_CORE_WIDTH)

        this.powerWires.write(new Float32Array(out))
    }

    /**
     * Moves every pulse a frame down its wire and rebuilds them.
     *
     * Positions come out of one phase rather than each pulse carrying its own:
     * they are evenly spaced by construction, so where the first one is says
     * where all of them are. Nothing to spawn, nothing to retire, and no drift
     * between runs however long the selection is held.
     */
    private rebuildPulses(dt: number): void {
        if (this.wireRuns.length === 0) return

        // Wrapped at the spacing, so the phase stays small however long a
        // selection is held rather than growing until it loses precision
        this.pulsePhase = (this.pulsePhase + PULSE_SPEED * dt) % PULSE_SPACING

        const out: number[] = []

        for (const run of this.wireRuns) {
            const dx = run.to.x - run.from.x
            const dy = run.to.y - run.from.y
            const length = Math.hypot(dx, dy)
            if (length <= 0) continue

            const stepX = dx / length
            const stepY = dy / length

            const { r, g, b } = run.ink
            for (let along = this.pulsePhase; along <= length; along += PULSE_SPACING) {
                appendDot(
                    out,
                    run.from.x + stepX * along,
                    run.from.y + stepY * along,
                    PULSE_SIZE,
                    r * PULSE_STRENGTH, g * PULSE_STRENGTH, b * PULSE_STRENGTH,
                )
            }
        }

        this.wirePulses.write(new Float32Array(out))
    }

    /**
     * Washes the cells a source reaches, and outlines where that stops.
     *
     * The edge is drawn only where a covered cell has an uncovered neighbour, so
     * it comes out as the actual boundary of the reach rather than a border
     * around every cell in it. Stepped rather than round, because the reach is
     * decided cell by cell and a smooth circle would be drawing a promise the
     * network does not keep.
     */
    private buildReachMark(at: { col: number; row: number; layer: ShipLayer }): void {
        const cells = reachedCells(this.ship, at.layer, at.col, at.row)
        if (cells.length === 0) return

        const covered = new Set(cells.map((cell) => cellKey(cell.col, cell.row)))
        const ink = this.markerInk(REACH_COLOR)

        const fill: number[] = []
        const edges: number[] = []

        for (const cell of cells) {
            const { x, y } = this.cellCorner(cell.col, cell.row)

            fill.push(
                x, y, ink.r * REACH_FILL_STRENGTH, ink.g * REACH_FILL_STRENGTH, ink.b * REACH_FILL_STRENGTH,
                x + CELL, y, ink.r * REACH_FILL_STRENGTH, ink.g * REACH_FILL_STRENGTH, ink.b * REACH_FILL_STRENGTH,
                x + CELL, y + CELL, ink.r * REACH_FILL_STRENGTH, ink.g * REACH_FILL_STRENGTH, ink.b * REACH_FILL_STRENGTH,
                x, y, ink.r * REACH_FILL_STRENGTH, ink.g * REACH_FILL_STRENGTH, ink.b * REACH_FILL_STRENGTH,
                x + CELL, y + CELL, ink.r * REACH_FILL_STRENGTH, ink.g * REACH_FILL_STRENGTH, ink.b * REACH_FILL_STRENGTH,
                x, y + CELL, ink.r * REACH_FILL_STRENGTH, ink.g * REACH_FILL_STRENGTH, ink.b * REACH_FILL_STRENGTH,
            )

            for (const [dc, dr] of NEIGHBOURS) {
                if (covered.has(cellKey(cell.col + dc, cell.row + dr))) continue

                // The shared edge with the neighbour that is not covered
                const ax = x + (dc > 0 ? CELL : 0)
                const ay = y + (dr > 0 ? CELL : 0)
                const bx = ax + (dc === 0 ? CELL : 0)
                const by = ay + (dr === 0 ? CELL : 0)

                const { r, g, b } = ink
                edges.push(
                    ax, ay, r * REACH_EDGE_STRENGTH, g * REACH_EDGE_STRENGTH, b * REACH_EDGE_STRENGTH,
                    bx, by, r * REACH_EDGE_STRENGTH, g * REACH_EDGE_STRENGTH, b * REACH_EDGE_STRENGTH,
                )
            }
        }

        const out = fill
        thickenSegments(out, edges, REACH_EDGE_WIDTH)
        this.reachMark.write(new Float32Array(out))
    }

    /** The top-left corner of a cell in world units. */
    private cellCorner(col: number, row: number): Vec2 {
        return { x: (col - this.origin.x) * CELL, y: (row - this.origin.y) * CELL }
    }

    /** The middle of a cell in world units, which is where a wire ends. */
    private cellCentre(col: number, row: number): Vec2 {
        return {
            x: (col + 0.5 - this.origin.x) * CELL,
            y: (row + 0.5 - this.origin.y) * CELL,
        }
    }

    /*~~~ Selection ~~~*/

    /**
     * Which block a click at this cell is asking about.
     *
     * The brush's own layer wins so painting selects what you just placed. Failing
     * that it takes the topmost occupied layer, which is what makes a hull block
     * selectable while the brush is set to place thrusters.
     */
    /**
     * Selects whatever is under the pointer, and follows it to its layer.
     *
     * Switching the brush's layer is the point: picking a cosmetic block and then
     * finding the level buttons wired to it while the panel still says you are
     * building on hull is the kind of mismatch that makes an editor feel haunted.
     */
    private selectAt(col: number, row: number): void {
        const picked = this.pickAt(col, row)
        this.selected = picked

        if (picked && picked.layer !== this.brush.layer) {
            this.patchBrush({ layer: picked.layer })
        }
    }

    /**
     * The block under the pointer, taken from the top down.
     *
     * Whatever is drawn there is what gets picked, which means walking the layers
     * from the top and taking the first whose *shape* actually covers the point -
     * not merely the first that has a cell there. A cosmetic half block over a
     * thruster hits the half block on its solid side and the thruster through the
     * gap, which is what someone pointing at the thruster meant.
     *
     * Hidden layers are skipped: an outline round something nobody can see, with
     * the level buttons wired to it, is worse than no selection at all.
     *
     * Falls back to the brush's own layer when nothing is hit, so the panel can
     * say "empty" rather than keeping the last selection alive.
     */
    private pickAt(col: number, row: number): { col: number; row: number; layer: ShipLayer } | null {
        const { u, v } = this.cursorCell()

        // Reversed, because SHIP_LAYERS is draw order and the top one is drawn last
        for (const layer of [...SHIP_LAYERS].reverse()) {
            if (this.layerView[layer] === "hidden") continue

            const cell = this.ship.layers[layer].get(col, row)
            if (!cell) continue

            if (blockCovers(cell, u, v)) return { col, row, layer }
        }

        if (this.layerView[this.brush.layer] === "hidden") return null

        return { col, row, layer: this.brush.layer }
    }

    /**
     * Tells the panel about the selected cell, when it has actually changed.
     *
     * Rebuilt from the grid every frame rather than cached, so upgrading a level
     * or repainting the cell shows up without anything having to remember to
     * invalidate it. The key check is what keeps that from republishing 60 times
     * a second.
     */
    private publishSelection(): void {
        const at = this.selected
        const cell = at ? this.ship.layers[at.layer].get(at.col, at.row) : undefined

        const key = cell && at
            ? `${at.layer},${at.col},${at.row},${cell.shape},${cell.type},${cell.level},${cell.turns},${cell.mirrored},${cell.facing},${cell.steering},${cell.color.hex},${this.layerView.markers}`
            : ""

        if (key === this.selectionKey) return
        this.selectionKey = key

        // The outline is what ties the info panel to a block on screen - without
        // it the panel describes a cell you have no way to point at
        this.selectedBox.write(
            cell && at
                ? this.cellOutline(at.col, at.row, this.markerInk(SELECTED_COLOR), at.layer)
                : EMPTY_MESH,
        )

        if (!cell || !at) {
            this.context.publish("selected", null)
            return
        }

        const selected: SelectedCell = {
            col: at.col,
            row: at.row,
            layer: at.layer,
            shape: cell.shape,
            type: cell.type,
            typeName: componentById(cell.type).name,
            level: cell.level,
            maxLevel: maxLevel(cell.type),
            turns: cell.turns,
            mirrored: cell.mirrored,
            facing: cell.facing,
            steering: cell.steering,
            color: cell.color.hex,
            hitPoints: cell.hitPoints,
            mass: cell.mass,
        }

        this.context.publish("selected", selected)
    }

    /**
     * Re-levels the selected block, clamped to what its type actually has.
     *
     * Goes through set() rather than assigning `cell.level`, because the level is
     * what hit points and mass are derived from - writing the field alone would
     * leave a level 3 block with a level 1 body.
     */
    private changeSelectedLevel(delta: number): void {
        const at = this.selected
        if (!at) return

        const grid = this.ship.layers[at.layer]
        const cell = grid.get(at.col, at.row)
        if (!cell) return

        const level = Math.min(maxLevel(cell.type), Math.max(1, cell.level + delta))
        if (level === cell.level) return

        this.pushUndo()
        grid.set(at.col, at.row, cell.shape, {
            turns: cell.turns,
            mirrored: cell.mirrored,
            type: cell.type,
            level,
            facing: cell.facing,
            color: cell.color,
            accentColor: cell.accentColor,
            emission: cell.emission,
        })
    }

    /*~~~ Editing ~~~*/
    /**
     * Snapshots the ship, once, before the first change of a stroke.
     *
     * Called by each edit rather than by the press, so clicking empty space,
     * repainting an identical block or being refused outright leaves the undo
     * stack alone. A drag still costs exactly one step, because the flag survives
     * until the next press.
     */
    private beginEdit(): void {
        if (this.strokeEdited) return

        this.strokeEdited = true
        this.pushUndo()
    }

    private apply(col: number, row: number): void { // NOTE: May need to change to apply to layer?
        const brush = this.brush
        const grid = this.ship.layers[brush.layer]

        // Before the tool is even considered: a hidden layer takes no edits and no
        // selections, and a click that quietly does nothing is worse than one that
        // explains itself
        if (this.onHiddenLayer) {
            this.notify(`the ${brush.layer} layer is hidden`)
            return
        }

        // Selecting is what the press already did. Anything else here would make
        // "look at this block" destructive.
        if (brush.tool === "select") return

        if (brush.tool === "destroy") {
            // An empty cell is not an edit, and a drag crosses plenty of them
            if (!grid.has(col, row)) return

            const legal = canEraseAt(this.ship, brush.layer, col, row)
            if (!legal.ok) {
                this.notify(legal.reason ?? "that block cannot be erased")
                return
            }

            this.beginEdit()
            grid.delete(col, row)
            // A successful edit is what clears the last refusal
            this.notify(null)
            return
        }

        // The same call that drew the marks, so what is offered and what is
        // accepted cannot drift apart
        if (!canPlaceAt(this.ship, brush.layer, col, row, brush.type).ok) return
        if (this.matchesBrush(grid.get(col, row))) return

        this.beginEdit()
        grid.set(col, row, brush.shape, {
            turns: brush.turns,
            mirrored: brush.mirrored,
            type: brush.type,
            level: Math.min(brush.level, maxLevel(brush.type)),
            facing: this.facingFor(col, row),
            color: Color.from(brush.color),
            accentColor: brush.accentColor === "" ? null : Color.from(brush.accentColor),
            emission: emissionFor(brush),
        })
    }

    /**
     * The next facing a thruster could actually be placed with, here.
     *
     * Stepping blindly by one looks broken: only the facings that reach an edge
     * are legal, `bestThrusterFacing` snaps the rest to the same fallback, and so
     * two of every four presses appeared to do nothing. Stepping through the legal
     * ones means every press changes the thing on screen.
     *
     * Falls back to a plain step where nothing is legal - the cursor is off the
     * ship, and a key that does nothing at all is worse than one that spins a
     * value nobody can see yet.
     */
    private nextThrusterFacing(): number {
        const [col, row] = this.getGridPositionFromMouse()
        const options = thrusterFacings(this.ship, col, row)

        // Nothing legal here means the cursor is off the ship, and a key that does
        // nothing at all is worse than one that spins a value not yet on screen
        if (options.length === 0) return (this.brush.facing + 1) % 4

        return nextFacing(options, this.brush.facing)
    }

    /**
     * The facing a block is placed with.
     *
     * Only thrusters care: the cell is legal when some direction reaches an edge,
     * so one that does is better than refusing the placement over which way the
     * brush happened to be left pointing.
     */
    private facingFor(col: number, row: number): number {
        return kindOf(this.brush.type) === "thruster"
            ? bestThrusterFacing(this.ship, col, row, this.brush.facing)
            : this.brush.facing
    }

    /**
     * True when placing would change nothing.
     *
     * A drag revisits the same cell for many frames, and each set() would bump
     * geometryRevision and re-tessellate the whole layer. Turns and facing count
     * here: rotating the brush and repainting a cell has to actually rotate it.
     */
    private matchesBrush(cell: Cell | undefined): boolean {
        const brush = this.brush

        return cell !== undefined
            && cell.shape === brush.shape
            && cell.turns === brush.turns
            && cell.mirrored === brush.mirrored
            && cell.type === brush.type
            && cell.level === brush.level
            && cell.facing === brush.facing
            && cell.emission === emissionFor(brush)
            && cell.color.hex === brush.color
            && (cell.accentColor?.hex ?? "") === brush.accentColor
    }

    private snapshot(): Snapshot {
        const snap = {} as Snapshot
        for (const layer of SHIP_LAYERS) snap[layer] = this.ship.layers[layer].list.map((c) => ({ ...c }))
        return snap
    }

    private restore(snap: Snapshot): void {
        for (const layer of SHIP_LAYERS) {
            const grid = this.ship.layers[layer]
            grid.clear()

            // set() takes every field back, including stat overrides, so a restore
            // is lossless without needing an inverse for each mutation
            for (const cell of snap[layer]) {
                grid.set(cell.col, cell.row, cell.shape, { ...cell })
            }
        }
    }

    private pushUndo(): void {
        this.undoStack.push(this.snapshot())
        if (this.undoStack.length > 50) this.undoStack.shift()
        // A new edit invalidates any redo branch
        this.redoStack.length = 0
    }

    /** Snapshots, runs the change, and drops the redo branch. */
    private mutate(change: () => void): void {
        this.pushUndo()
        change()
    }

    private undo(): void {
        const previous = this.undoStack.pop()
        if (!previous) return

        this.redoStack.push(this.snapshot())
        this.restore(previous)
    }

    private redo(): void {
        const next = this.redoStack.pop()
        if (!next) return

        this.undoStack.push(this.snapshot())
        this.restore(next)
    }

    /** Swaps in a whole different ship, undoably. */
    private replaceShip(ship: Ship, restoring = false): void {
        // A restore is the ship you were already editing, coming back from a test
        // flight. There is no earlier state in this session to undo to, and the
        // zoom you left at is the one you expect to find - a fit here would throw
        // it away, and on a small hull it fills the screen with one block
        if (!restoring) this.pushUndo()

        this.ship = ship
        if (!restoring) this.frameShip()

        // A fresh ship's revision counter starts from its own sets and can land on
        // the number already cached, which would leave the previous ship's meshes
        // on screen. Force the rebuild rather than hope the two differ.
        this.builtRevision = -1
    }

    /**
     * Points the camera at the whole ship.
     *
     * Only on a load, never on an edit: refitting while you build would shift the
     * grid under the cursor every time the hull grew past its old bounds.
     */
    private frameShip(): void {
        const bounds = this.ship.bounds
        if (!bounds) return

        const gpu = this.context.gpu
        this.camera.fit(
            (bounds.minCol - this.origin.x) * CELL,
            (bounds.minRow - this.origin.y) * CELL,
            (bounds.maxCol + 1 - this.origin.x) * CELL,
            (bounds.maxRow + 1 - this.origin.y) * CELL,
            gpu.width,
            gpu.height,
            // Roomier than the default: the toolbars cover the edges of the canvas
            0.35,
        )
    }

    private load(text: string): void {
        try {
            const { ship, warnings } = shipFromText(text)
            this.replaceShip(ship)
            for (const warning of warnings) console.warn(`ship-builder: ${warning}`)
        } catch (error) {
            console.error("ship-builder: that file is not valid ship JSON.", error)
        }
    }

    /*~~~ Meshes ~~~*/
    private rebuildMeshes(): void {
        const gpu = this.context.gpu

        for (const mesh of this.meshes.values()) mesh.destroy()
        this.meshes.clear()
        this.shadingReach = 1

        // Only the layers actually on screen light anything: a glow cast by a
        // hidden cosmetic would sit on the hull with nothing visible making it
        const shown = SHIP_LAYERS
            .filter((layer) => this.layerView[layer] !== "hidden")
            .map((layer) => this.ship.layers[layer])
        const sources = emissiveSources(shown)

        for (const layer of SHIP_LAYERS) {
            const view = this.layerView[layer]
            if (view === "hidden") continue

            // No fade baked in: dimming is the instance's alpha at draw time, so
            // the mesh no longer depends on how the layer is being viewed
            const builder = new MeshBuilder()
            const grid = this.ship.layers[layer]
            appendLayer(builder, grid, CELL, this.origin, 0, BACKGROUND, spillOnto(grid, sources))

            // Across every layer, since the hull is shaded as one object
            this.shadingReach = Math.max(this.shadingReach, builder.cellReach)

            if (builder.vertexCount > 0) this.meshes.set(layer, builder.build(gpu, layer))
        }

        // One mesh across every layer, since it is laid over the whole ship
        const bloom = new MeshBuilder()
        for (const layer of SHIP_LAYERS) {
            if (this.layerView[layer] === "hidden") continue
            appendEmissiveBloom(bloom, this.ship.layers[layer], CELL, this.origin)
        }

        this.bloomMesh?.destroy()
        this.bloomMesh = bloom.vertexCount > 0 ? bloom.build(gpu, "builder bloom") : null

        this.buildMassMark()
        this.publishPalette()
        this.publishShipInfo()
        this.builtRevision = this.ship.geometryRevision
    }

    /**
     * The center of mass, as an orange cross over the hull.
     *
     * Rebuilt with the layer meshes rather than every frame, because it only
     * moves when a block does - which is exactly when this runs.
     */
    private buildMassMark(): void {
        this.massMark?.destroy()
        this.massMark = null

        if (this.ship.mass <= 0) return

        const center = this.ship.centerOfMass
        const builder = new MeshBuilder()

        appendCross(
            builder,
            (center.x - this.origin.x) * CELL,
            (center.y - this.origin.y) * CELL,
            CELL * 0.8,
            this.markerInk(MASS_COLOR),
        )

        this.massMark = builder.build(this.context.gpu, "center of mass")
    }

    /** The running totals the info panel shows. */
    private publishShipInfo(): void {
        const bounds = this.ship.bounds
        const perLayer = {} as Record<ShipLayer, number>
        for (const layer of SHIP_LAYERS) perLayer[layer] = this.ship.layers[layer].size

        const info: ShipInfo = {
            name: this.ship.name,
            creator: this.ship.creator,
            mass: this.ship.mass,
            blocks: this.ship.layersOf().reduce((sum, grid) => sum + grid.size, 0),
            width: bounds ? bounds.maxCol - bounds.minCol + 1 : 0,
            height: bounds ? bounds.maxRow - bounds.minRow + 1 : 0,
            perLayer,
            perKind: countKinds(this.ship),
            cost: shipCost(this.ship),
            costPerKind: costByKind(this.ship),
            issues: structuralIssues(this.ship),
        }

        this.context.publish("shipInfo", info)
    }

    /** The distinct colors already in the ship, for the panel's swatch row. */
    private publishPalette(): void {
        const hexes = new Set<string>()

        for (const grid of this.ship.layersOf()) {
            for (const cell of grid.list) hexes.add(cell.color.hex)
        }

        this.context.publish("palette", [...hexes].sort())
    }

    /**
     * A mark on every cell the current brush may legally fill.
     *
     * Bounded by the hull plus a margin rather than by the viewport: the set of
     * placeable cells is small and known, and scanning what is on screen would
     * rebuild on every pan.
     */
    private rebuildMarks(): void {
        const brush = this.brush
        const key = `${this.ship.geometryRevision}|${brush.layer}|${brush.type}|${brush.facing}|${brush.tool}|`
            + `${this.layerView.markers}|${this.layerView[brush.layer]}`
        if (key === this.marksKey) return
        this.marksKey = key

        this.marks.write(EMPTY_MESH)

        // Marks answer "where could this go", which is a question only the paint
        // tool is asking. Erasing and selecting act on what is already there.
        if (brush.tool !== "build") return

        // Nothing can go anywhere on a hidden layer, so offering cells would be a
        // promise the click will refuse
        if (this.onHiddenLayer) return

        const bounds = this.ship.bounds
        const out: number[] = []

        for (let row = (bounds?.minRow ?? 0) - MARGIN; row <= (bounds?.maxRow ?? 0) + MARGIN; row++) {
            for (let col = (bounds?.minCol ?? 0) - MARGIN; col <= (bounds?.maxCol ?? 0) + MARGIN; col++) {
                if (!canPlaceAt(this.ship, brush.layer, col, row, brush.type).ok) continue
                appendMark(out, col, row, this.origin, this.markerInk(MARK_COLOR))
            }
        }

        this.marks.write(new Float32Array(out))
    }

    /**
     * A red wash over every block the destroy tool would refuse.
     *
     * The counterpart to the legal-placement marks: the erase rules are only
     * discoverable by being refused otherwise, which teaches them one annoyance
     * at a time. Drawn as each block's own shape rather than a flat square so the
     * wash lands on the block and not on the empty half of a wedge.
     */
    /**
     * The ship through the lit pipeline, as a preview of how it will actually look.
     *
     * One instance and one light, placed relative to the hull's own reach so the
     * preview reads the same on a fighter and on a freighter. The light is fixed
     * rather than another set of sliders: this is a look, not a lighting rig, and
     * the ship viewer already has the rig.
     */
    /**
     * Draws every visible layer, dimmed ones blended.
     *
     * In SHIP_LAYERS order with the pipeline switched per layer rather than
     * grouped by pipeline: without a depth buffer the last thing drawn wins, and
     * a dimmed *hull* under a full cosmetic still has to be drawn first. Grouping
     * the blended draws together would quietly put them on top.
     */
    private drawLayers(frame: Frame, solid: Pipeline, blended: Pipeline, lights?: GPUBindGroup): void {
        const camera = this.context.renderer.camera

        for (const layer of SHIP_LAYERS) {
            const mesh = this.meshes.get(layer)
            if (!mesh) continue

            const dim = this.layerView[layer] === "dim"
            frame.setPipeline(dim ? blended : solid).setBindGroup(0, camera.group)
            if (lights) frame.setBindGroup(1, lights)

            ;(dim ? this.dimBatch : this.litBatch).draw(frame, mesh)
        }
    }

    private drawLit(frame: Frame): void {
        const renderer = this.context.renderer
        const reach = this.shadingReach

        // Up and to the left, far enough out that the whole hull is on the near
        // side of it and the terminator falls across the ship rather than past it
        this.sun.position = { x: -1.1 * reach, y: -1.1 * reach }
        this.sun.range = 2.5 * reach
        this.sun.intensity = 1.15

        this.lights.setShading(DEFAULT_SHADING)
        this.lights.begin().add(this.field.sample({ x: 0, y: 0 }, 0), reach)
        this.lights.upload()

        // The mesh sits where it was built, so the instance is the identity one.
        // Both batches hold exactly one, so both read surfaces[0] and the lighting
        // is identical - only the alpha differs.
        this.litBatch.begin().add(0, 0, 0, 1, 1, 1, 1, 1)
        this.dimBatch.begin().add(0, 0, 0, 1, 1, 1, 1, DIM_ALPHA)

        this.drawLayers(frame, renderer.lit, renderer.litAlpha, this.lights.group)

        // The emissive halo, over the hull it spills off. Part of the preview
        // rather than the flat view: a glow is light, and the flat view is the one
        // that deliberately shows none
        if (this.bloomMesh) {
            frame.setPipeline(renderer.instancedGlow).setBindGroup(0, renderer.camera.group)
            this.litBatch.draw(frame, this.bloomMesh)
        }
    }

    /**
     * A wash over every engine marked for steering, coloured by which way it turns.
     *
     * Only the engines that would actually turn the ship: one lined up through the
     * centre of mass has no leverage, so marking it green or blue would promise a
     * turn that never comes. Those are left unmarked, which is itself the useful
     * signal - a steering flag on a nozzle with no colour is a nozzle doing nothing.
     */
    private rebuildSteering(): void {
        const views = VIEW_LAYERS.map((layer) => this.layerView[layer]).join(",")

        // The plain revision, not the geometry one: flipping the steering flag
        // changes no triangles on the ship and would otherwise never repaint
        const key = `${this.ship.revision}|${views}`
        if (key === this.steeringKey) return
        this.steeringKey = key

        const center = this.ship.centerOfMass
        const out: number[] = []

        for (const layer of SHIP_LAYERS) {
            if (this.layerView[layer] === "hidden") continue

            for (const cell of this.ship.layers[layer].ofKind("thruster")) {
                if (!cell.steering) continue

                const turn = turnSignOf(cell, center)
                if (turn === 0) continue

                const { r, g, b } = this.markerInk(turn < 0 ? TURN_LEFT_COLOR : TURN_RIGHT_COLOR)
                appendCellBorder(out, cell.col, cell.row, this.origin, r, g, b)
            }
        }

        const thick: number[] = []
        thickenSegments(thick, out, OUTLINE_WIDTH)
        this.steeringBoxes.write(new Float32Array(thick))
    }

    private rebuildProtected(): void {
        const brush = this.brush
        // Every view belongs in the key, markers included: hiding the layer above
        // uncovers hull and dimming the markers repaints the wash, and neither
        // touches the ship. VIEW_LAYERS rather than SHIP_LAYERS is the whole point
        // - leaving markers out is what left the red at full strength when dimmed.
        const views = VIEW_LAYERS.map((layer) => this.layerView[layer]).join(",")
        const key = `${this.ship.geometryRevision}|${brush.layer}|${brush.tool}|${views}`
        if (key === this.protectedKey) return
        this.protectedKey = key

        this.protectedBoxes?.destroy()
        this.protectedBoxes = null

        // Only the destroy tool is asking "what can come off"
        if (brush.tool !== "destroy") return

        // Marking blocks on a layer nobody can see would leave a red shape floating
        // over whatever is behind it
        if (this.layerView[brush.layer] === "hidden") return

        const builder = new MeshBuilder()

        for (const cell of this.ship.layers[brush.layer].list) {
            if (canEraseAt(this.ship, brush.layer, cell.col, cell.row).ok) continue

            // The wash draws after every layer, so on a covered block it would land
            // on whatever sits above and mark the wrong thing entirely
            if (this.coveredAbove(brush.layer, cell.col, cell.row)) continue

            // The block's own shape, not its art: only hull is ever protected and
            // hull-plate has no art. Give hull art and this wash becomes a hexagon
            // over a turret, and wants rebuilding on top of appendBlock instead.
            const { shape, turns, mirrored } = displayBlock(cell)
            const x = cell.col * CELL - this.origin.x * CELL
            const y = cell.row * CELL - this.origin.y * CELL

            // Tinted from the block's own colour, so it reads as a wash over the
            // block rather than a solid red tile replacing it
            appendShape(
                builder, shape, turns, mirrored, x, y, CELL,
                this.markerInk(cell.color.mix(PROTECTED_COLOR, PROTECTED_TINT)),
            )
        }

        if (builder.vertexCount > 0) {
            this.protectedBoxes = builder.build(this.context.gpu, "protected blocks")
        }
    }

    /**
     * A marker's colour, washed out when the markers layer is dimmed.
     *
     * Every mark goes through here rather than reading its constant directly, so
     * the dim state is one rule instead of five that can drift apart.
     */
    private markerInk(base: Color): Color {
        return this.layerView.markers === "dim" ? base.mix(BACKGROUND, MARKER_DIM_FADE) : base
    }

    /**
     * True when the layer the brush is on cannot be seen.
     *
     * Every interaction checks this: editing blocks you have no way to look at is
     * how a ship ends up with a block nobody remembers placing.
     */
    private get onHiddenLayer(): boolean {
        return this.layerView[this.brush.layer] === "hidden"
    }

    /** True when the markers layer is switched off entirely. */
    private get markersHidden(): boolean {
        return this.layerView.markers === "hidden"
    }

    /**
     * True when a block that is actually being drawn sits over this cell.
     *
     * "Above" is later in SHIP_LAYERS, which is draw order - the same order that
     * decides what the eye ends up seeing. A hidden layer covers nothing, so
     * switching it off exposes the hull beneath and the wash comes back.
     */
    private coveredAbove(layer: ShipLayer, col: number, row: number): boolean {
        const above = SHIP_LAYERS.slice(SHIP_LAYERS.indexOf(layer) + 1)

        return above.some(
            (other) => this.layerView[other] !== "hidden" && this.ship.layers[other].has(col, row),
        )
    }

    /**
     * Takes a refusal off screen once it has been up long enough to read.
     *
     * The clock lives here rather than in the panel because the scene owns the
     * message: a panel that hid it on its own timer would leave the scene still
     * holding the string, and repeating the same refusal would publish nothing.
     */
    /**
     * Writes the ship straight back over its file in assets/ships.
     *
     * The same text the download button produces, put where the download would
     * have had to be moved to by hand. Vite's glob picks the change up, so the
     * ship reloads without a restart.
     *
     * Named for the id rather than the name, because the id is what the file is
     * called and what the picker lists - renaming a ship in the panel should not
     * quietly start writing a second file.
     */
    private async saveInPlace(): Promise<void> {
        const id = this.ship.id
        const text = shipToText(this.ship)

        // Stashed before the request, because the reload the write triggers can
        // land before the response does
        try {
            sessionStorage.setItem(RESTORE_KEY, text)
        } catch (reason) {
            console.warn("ship-builder: could not stash the ship before saving.", reason)
        }

        try {
            const response = await fetch("/games/space_game/api/ship", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ id, text }),
            })

            if (!response.ok) {
                // The endpoint says why in plain words, so pass its reason on
                // rather than replacing it with a status code
                this.notify(await response.text().catch(() => `Could not save ${id}.json`))
                return
            }

            this.notify(`Saved ${id}.json`)
        } catch (reason) {
            console.error("ship-builder: saving failed.", reason)
            this.notify("Could not reach the dev server to save.")
        }
    }

    /**
     * Picks the ship back up after the reload a save causes.
     *
     * Consumed on read, so it only ever restores the once - a later visit to the
     * builder starts empty, the way it always has.
     */
    private restoreAfterSave(): void {
        let text: string | null = null

        try {
            text = sessionStorage.getItem(RESTORE_KEY)
            sessionStorage.removeItem(RESTORE_KEY)
        } catch (reason) {
            console.warn("ship-builder: could not read the stashed ship.", reason)
            return
        }

        if (text === null) return

        const { ship, warnings } = shipFromText(text)
        for (const warning of warnings) console.warn(`restore: ${warning}`)

        this.replaceShip(ship, true)
        this.notify(`Saved ${ship.id}.json`)
    }

    private ageNotice(dt: number): void {
        if (this.notice === null) return

        this.noticeAge += dt
        if (this.noticeAge >= NOTICE_SECONDS) this.notify(null)
    }

        /**
     * Everything that follows the cursor: the cell outline and the block a click
     * would place.
     *
     * One key covers both, because both change on the same events - moving to
     * another cell, or picking a different block.
     */
    private rebuildCursor(col: number, row: number): void {
        const brush = this.brush
        // A hidden layer refuses everything, so the cursor reads blocked wherever
        // it sits rather than promising a placement the click will turn down
        const placeable = !this.onHiddenLayer
            && canPlaceAt(this.ship, brush.layer, col, row, brush.type).ok

        const cursor = this.cursorOutline(col, row, placeable)

        const key = `${col},${row},${this.input.pointer.over},${placeable},${cursor?.layer},` +
            `${cursor?.color.hex},${brush.shape},${brush.turns},${brush.mirrored},` +
            `${brush.tool},${brush.color},${brush.type},${brush.level},${brush.facing},` +
            `${this.ship.revision}`

        if (key === this.hoverKey) return
        this.hoverKey = key

        this.hover.write(EMPTY_MESH)
        this.ghost.write(EMPTY_MESH)
        if (!this.input.pointer.over) return

        if (cursor) {
            this.hoverLegal = cursor.color === HOVER_COLOR
            this.hover.write(this.cellOutline(col, row, cursor.color, cursor.layer))
        }

        // Nothing to preview when destroying or selecting, nothing to promise on a
        // cell that would refuse the block, and nothing to add on one that already
        // holds exactly this - a ghost over an identical block is just a smudge
        const identical = this.matchesBrush(this.ship.layers[brush.layer].get(col, row))
        if (brush.tool === "build" && placeable && !identical) this.ghost.write(this.buildGhost(col, row))
    }

    /**
     * What the cursor should outline, and in what colour - or nothing.
     *
     * Each tool marks the thing it would actually act on, which is not the same
     * thing for all three:
     *
     *   - **build** marks the cell a block would land in, on the brush's layer,
     *     red when that placement would be refused.
     *   - **destroy** marks the block a click would remove, orange, or red when
     *     the ship needs it. It works on the brush's layer, so that is the layer
     *     it looks at - an outline round a block the click would not touch is
     *     worse than no outline.
     *   - **select** marks whatever is under the cursor, whichever visible layer
     *     it is on, and is never refused.
     */
    private cursorOutline(
        col: number, row: number, placeable: boolean,
    ): { layer: ShipLayer; color: Color } | null {
        const brush = this.brush

        if (brush.tool === "build") {
            return { layer: brush.layer, color: placeable ? HOVER_COLOR : BLOCKED_COLOR }
        }

        if (brush.tool === "destroy") {
            // Nothing there is nothing to delete, and a marker over empty space
            // would be warning about an act nobody can perform
            if (this.onHiddenLayer || !this.ship.layers[brush.layer].has(col, row)) return null

            const erasable = canEraseAt(this.ship, brush.layer, col, row).ok
            return { layer: brush.layer, color: erasable ? DELETE_COLOR : BLOCKED_COLOR }
        }

        const picked = this.pickAt(col, row)
        return { layer: picked?.layer ?? brush.layer, color: HOVER_COLOR }
    }

    /**
     * The outline of whatever is drawn in a cell, as thick triangles.
     *
     * Traced from `appendBlock` - the same call that draws the block - rather
     * than from the cell's `shape` field. A component's shape is leftover brush
     * state that nothing renders: components draw as their art, so outlining the
     * stored shape drew a quarter round a thruster. Asking the drawing code means
     * a hull outlines as its wedge and a turret outlines as a turret.
     *
     * An empty cell has nothing drawn in it, so it falls back to the cell box -
     * there the square *is* the truth about what is being pointed at.
     */
    private cellOutline(
        col: number, row: number, color: Color, layer?: ShipLayer,
    ): Float32Array<ArrayBuffer> {
        const cell = layer ? this.ship.layers[layer].get(col, row) : undefined
        const segments: number[] = []

        if (cell) {
            const x = (col - this.origin.x) * CELL
            const y = (row - this.origin.y) * CELL
            const scratch = new MeshBuilder()

            appendBlock(scratch, cell, x, y, CELL)
            appendTriangleOutline(segments, scratch.toArray(), color)
        } else {
            const { r, g, b } = color
            appendCellBorder(segments, col, row, this.origin, r, g, b)
        }

        const out: number[] = []
        thickenSegments(out, segments, OUTLINE_WIDTH)
        return new Float32Array(out)
    }

    /**
     * The block a click would place, in its real geometry and orientation.
     *
     * Built through the same displayBlock the layer mesh uses, so a component
     * previews as the hexagon and facing bar it will actually become rather than
     * as whatever hull shape the brush was last holding.
     */
    private buildGhost(col: number, row: number): Float32Array<ArrayBuffer> {
        const builder = new MeshBuilder()

        // The same call the ship's own mesh makes, washed out: a preview drawn by
        // any other path is a preview that can lie about what a click will do
        appendBlock(
            builder,
            ghostCell(this.brush, this.facingFor(col, row)),
            (col - this.origin.x) * CELL,
            (row - this.origin.y) * CELL,
            CELL,
            GHOST_FADE,
            BACKGROUND,
        )

        return builder.toArray()
    }

    /**
     * Tells the user why something did not happen.
     *
     * Guarded on the last value because `apply` runs every frame of a drag -
     * holding the button over an illegal cell would otherwise publish sixty
     * identical messages a second.
     */
    private notify(reason: string | null): void {
        // A repeat of the same refusal is still a fresh one: it restarts the clock
        // without paying to republish an identical string
        this.noticeAge = 0

        if (reason === this.notice) return

        this.notice = reason
        this.context.publish("notice", reason)
    }

        /**
     * Marks the selected thruster as one the pilot steers with, or not.
     *
     * Through set() like the level change, so the revisions move and one path
     * writes cells - but hit points and mass are passed back in rather than
     * re-derived, because nothing about steering should cost a block its damage.
     */
    private setSelectedSteering(steering: boolean): void {
        const at = this.selected
        if (!at) return

        const grid = this.ship.layers[at.layer]
        const cell = grid.get(at.col, at.row)
        if (!cell || kindOf(cell.type) !== "thruster") return
        if (cell.steering === steering) return

        this.pushUndo()
        grid.set(at.col, at.row, cell.shape, {
            turns: cell.turns,
            mirrored: cell.mirrored,
            type: cell.type,
            level: cell.level,
            facing: cell.facing,
            color: cell.color,
            accentColor: cell.accentColor,
            emission: cell.emission,
            hitPoints: cell.hitPoints,
            mass: cell.mass,
            steering,
        })
    }
}






const scene: DevSceneDefinition<EditorValues> = {
    id: SCENE_ID,
    name: "Ship Builder",
    description:
        "Left drag paints, right or middle drag pans, wheel zooms. The brush is the " +
        "panel on the right; only marked cells accept a block. Undo covers a whole " +
        "stroke, not a single block.",
    settings: SETTINGS,
    ui: "builder",
    input: "builder",
    create: (context) => new ShipBuilder(context),
}

export default scene
