import { buildShip, findShip, SHIPS } from "../../assets/ships"
import { Ship } from "../../game/ship"
import { shipFromText, shipToText } from "../../game/shipJson"
import { Camera, CameraBinding, type Vec2 } from "../../render/camera"
import { Color } from "../../render/color"
import type { Frame } from "../../render/frame"
import { componentById, kindOf, maxLevel } from "../../render/grid/components"
import type { Cell } from "../../render/grid/grid"
import { SHIP_LAYERS, type ShipLayer } from "../../render/grid/layers"
import { appendShape, carriedTurns, turnCount, type BlockShape } from "../../render/grid/shapes"
import { bestThrusterFacing, canClearLayer, canEraseAt, canPlaceAt } from "../../render/grid/shipLegality"
import { Mesh, MeshBuilder, VERTEX_LAYOUT } from "../../render/mesh"
import type { InputService } from "../../input/service"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { Pipeline } from "../../render/webgpu/pipeline"
import { Shader } from "../../render/webgpu/shader"
import type { ActionsOf, SearchColumn, SettingsSchema, ValuesOf } from "../../settings/settings"
import { appendBlock, appendLayer, displayBlock, type BlockLike } from "../../render/grid/blockDraw"
import { layerFor, loadBrush, saveBrush, type Brush } from "../../render/grid/brush"
import { DRAWN_SHAPES } from "../../render/grid/palette"
import type { DevSceneDefinition } from "../DevScene"
import { downloadText, uploadText } from "../../download"

const HOVER_COLOR = Color.from("#ffffff")
const BLOCKED_COLOR = Color.from("#ff5a5a")
const MARK_COLOR = Color.from("#7fe0ff")
const MASS_COLOR = Color.from("#ff8c1a")
const SELECTED_COLOR = Color.from("#00ff40")
const HIGHLIGHT_COLOR = Color.from("#ffe14d")

/** How far the ghost is washed out. 0 is solid, 1 is invisible. */
const GHOST_FADE = 0.72

/**
 * How far a dimmed layer is washed toward the background.
 *
 * 0.85 leaves roughly the 15% of the original colour the button promises. There
 * is no alpha in the vertex format, so this mix against a known background is
 * what translucency means here.
 */
const DIM_FADE = 0.85

/** How strongly a protected block is tinted red. */
const PROTECTED_TINT = 0.45
const PROTECTED_COLOR = Color.from("#ff3b3b")

/** How long a refusal stays on screen before it dismisses itself, in seconds. */
const NOTICE_SECONDS = 5
const BACKGROUND = Color.rgb(0.05, 0.05, 0.07)

const CELL = 32
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
        // Past the default 8: the result box scrolls, so an unfiltered list
        // showing every ship beats one that silently stops at the eighth
        limit: 50,
    },

    metaSep:    { type: "separator", label: "Metadata" },

    name:       { type: "text", label: "Name", default: "New Ship" },
    creator:    { type: "text", label: "Creator", default: "Sandman" },
    
    actionsSep: { type: "separator", label: "Actions" },
    
    resolution: { type: "range", label: "Resolution", default: 1, min: 0.05, max: 1, step: 0.05 },
    test:       { type: "button", label: "Test Ship (NOT IMPL)" },
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
    private readonly cameraBinding: CameraBinding
    private readonly meshPipeline: Pipeline
    private readonly linePipeline: Pipeline

    private ship = new Ship("untitled", "New Ship")

    // Meshes
    private readonly meshes = new Map<ShipLayer, Mesh>()
    private marks: Mesh | null = null
    private marksKey = ""
    /** Red wash over blocks the destroy tool would refuse. */
    private protectedBoxes: Mesh | null = null
    private protectedKey = ""
    private hover: Mesh | null = null
    private ghost: Mesh | null = null
    /** The center-of-mass cross, rebuilt whenever the geometry moves it. */
    private massMark: Mesh | null = null

    /**
     * The cell the pointer last pressed on, whether or not anything is there.
     *
     * Kept as coordinates rather than as a Cell so it survives an edit: upgrading
     * a block replaces the object in the grid, and a held reference would go
     * stale the moment the info panel changed anything.
     */
    private selected: { col: number; row: number; layer: ShipLayer } | null = null
    private selectionKey = ""
    private selectedBox: Mesh | null = null

    /** The palette swatch the pointer is over, as hex, or null when it is not. */
    private highlight: string | null = null
    private highlightKey = ""
    private highlightBoxes: Mesh | null = null

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
    private lastName = ""
    private lastCreator = ""
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
        download: () => downloadText(`${this.ship.id}.json`, shipToText(this.ship)),
        upload: () => uploadText((text) => this.load(text)),
        test: () => {},
    }

    readonly actions: Record<ActionsOf<typeof SETTINGS>, () => void> = {
        test: () => this.commands.test!(),
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
        this.cameraBinding = CameraBinding.create(gpu)

        const shader = Shader.createNow(gpu, MESH_2D, "mesh 2d")
        const layouts = [this.cameraBinding.layout]

        this.meshPipeline = Pipeline.create(gpu, {
            label: "editor solid", shader, layouts, vertexBuffers: [VERTEX_LAYOUT],
        })
        this.linePipeline = Pipeline.create(gpu, {
            label: "editor lines", shader, layouts, vertexBuffers: [VERTEX_LAYOUT],
            topology: "line-list",
        })

        this.camera.zoom = 1

        // Published from the constructor, not on the first frame: load() clears the
        // channel before create() runs, so this is the first thing the panel sees
        this.publishBrush()
        this.context.publish("layerView", this.layerView)
    }

    update(dt: number, settings: EditorValues): void {
        this.settings = settings
        this.ageNotice(dt)
        // Cheap to set every frame: the setter early-returns when unchanged, and
        // fitCamera already reads gpu.width, so the camera refits itself
        this.context.gpu.resolutionScale = settings.resolution
        this.syncIdentity(settings)

        this.readShortcuts()

        const [col, row] = this.getGridPositionFromMouse()

        // A snapshot per stroke, not per cell, so one undo reverts a whole drag -
        // and not until an edit actually lands, so a refused or empty click costs
        // nothing
        if (this.input.pointer.pressed()) {
            this.strokeEdited = false

            // The press picks the cell the info panel talks about. Doing it on the
            // press rather than the release means painting a block also selects
            // it, which is what you want right after placing one.
            if (this.input.pointer.over) this.selected = this.pickAt(col, row)
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
        this.rebuildCursor(col, row)
        this.rebuildHighlight()
        this.publishSelection()
    }

    render(frame: Frame): void {
        const gpu = this.context.gpu
        const settings = this.settings
        if (!settings) return

        this.cameraBinding.upload(this.camera, gpu.width, gpu.height)

        // Solid geometry first: the ship, then what a click would add to it, then
        // the center-of-mass marker that has to read against both
        frame.setPipeline(this.meshPipeline).setBindGroup(0, this.cameraBinding.group)
        for (const layer of SHIP_LAYERS) {
            const mesh = this.meshes.get(layer)
            if (mesh) mesh.draw(frame)
        }

        // Over the ship it describes, under the ghost and the mass mark - it is a
        // wash on the blocks, not a thing in its own right
        const markers = !this.markersHidden
        if (markers && this.protectedBoxes) this.protectedBoxes.draw(frame)

        // The ghost stays: it is where the cursor is, not a mark about the ship,
        // and losing it would make the build tool feel broken
        if (this.ghost) this.ghost.draw(frame)
        if (markers && this.massMark) this.massMark.draw(frame)

        // Lines last, and the legal-cell marks last of all. They are the one thing
        // that has to stay readable over a finished hull, so nothing draws on top.
        frame.setPipeline(this.linePipeline).setBindGroup(0, this.cameraBinding.group)
        if (this.hover) this.hover.draw(frame)
        if (markers && this.highlightBoxes) this.highlightBoxes.draw(frame)
        if (markers && this.selectedBox) this.selectedBox.draw(frame)
        if (markers && this.marks) this.marks.draw(frame)

        this.context.stats.set("blocks", this.ship.layersOf().reduce((sum, g) => sum + g.size, 0))
        this.context.stats.set("undo depth", this.undoStack.length)
    }

    private getGridPositionFromMouse(): [col: number, row: number] {
        const world = this.camera.screenToWorld(this.input.pointer.x, this.input.pointer.y)
        const col = Math.floor(world.x / CELL + this.origin.x)
        const row = Math.floor(world.y / CELL + this.origin.y)
        return [col, row]
    }

    /** Keeps the ship's name, creator and filename in step with the fields. */
    private syncIdentity(settings: EditorValues): void {
        if (settings.name !== this.lastName) {
            this.lastName = settings.name
            this.ship.name = settings.name
            this.ship.id = slug(settings.name)
        }

        if (settings.creator !== this.lastCreator) {
            this.lastCreator = settings.creator
            this.ship.creator = settings.creator
        }

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
        this.marks?.destroy()
        this.protectedBoxes?.destroy()
        this.hover?.destroy()
        this.ghost?.destroy()
        this.massMark?.destroy()
        this.selectedBox?.destroy()
        this.highlightBoxes?.destroy()
        this.cameraBinding.destroy()
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
        const input = this.input

        if (input.pressed("builder.rotate")) this.rotateBrush()
        if (input.pressed("builder.mirror")) this.patchBrush({ mirrored: !this.brush.mirrored })

        // Cycles 1..max and wraps, so one key reaches every level of the type
        if (input.pressed("builder.cycleLevel")) {
            this.patchBrush({ level: (this.brush.level % maxLevel(this.brush.type)) + 1 })
        }

        if (input.pressed("builder.prevShape")) this.stepShape(-1)
        if (input.pressed("builder.nextShape")) this.stepShape(1)

        if (input.pressed("builder.layerUp")) this.stepLayer(-1)
        if (input.pressed("builder.layerDown")) this.stepLayer(1)
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

        this.highlightBoxes?.destroy()
        this.highlightBoxes = null
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

        if (out.length > 0) {
            this.highlightBoxes = Mesh.create(this.context.gpu, new Float32Array(out), "colour highlight")
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
    private pickAt(col: number, row: number): { col: number; row: number; layer: ShipLayer } | null {
        // Nothing on a layer you cannot see: the outline would sit around empty
        // space, and the level buttons would edit a block with nothing on screen
        // to show for it
        if (this.layerView[this.brush.layer] === "hidden") return null

        // The chosen layer and nothing else. Falling through to whatever else
        // happened to be under the cursor meant clicking bare hull while holding a
        // thruster selected the hull, and the panel then described a block on a
        // layer you were not working on - with the level buttons wired to it.
        //
        // The cell is returned even when it is empty, so the panel can say so
        // rather than keeping the last selection alive.
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
        this.selectedBox?.destroy()
        this.selectedBox = cell && at ? this.buildCellBox(at.col, at.row, this.markerInk(SELECTED_COLOR), "selected") : null

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
            emission: brush.emission,
        })
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
            && cell.emission === brush.emission
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
    private replaceShip(ship: Ship): void {
        this.pushUndo()
        this.ship = ship
        this.frameShip()

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

        for (const layer of SHIP_LAYERS) {
            const view = this.layerView[layer]
            if (view === "hidden") continue

            const builder = new MeshBuilder()
            const fade = view === "dim" ? DIM_FADE : 0

            appendLayer(builder, this.ship.layers[layer], CELL, this.origin, fade, BACKGROUND)
            if (builder.vertexCount > 0) this.meshes.set(layer, builder.build(gpu, layer))
        }

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

        this.marks?.destroy()
        this.marks = null

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

        if (out.length > 0) {
            this.marks = Mesh.create(this.context.gpu, new Float32Array(out), "legal cells")
        }
    }

    /**
     * A red wash over every block the destroy tool would refuse.
     *
     * The counterpart to the legal-placement marks: the erase rules are only
     * discoverable by being refused otherwise, which teaches them one annoyance
     * at a time. Drawn as each block's own shape rather than a flat square so the
     * wash lands on the block and not on the empty half of a wedge.
     */
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
        return this.layerView.markers === "dim" ? base.mix(BACKGROUND, DIM_FADE) : base
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
        const legal = !this.onHiddenLayer
            && canPlaceAt(this.ship, brush.layer, col, row, brush.type).ok

        const key = `${col},${row},${this.input.pointer.over},${legal},` +
            `${brush.shape},${brush.turns},${brush.mirrored},${brush.tool},${brush.color},` +
            `${brush.type},${brush.level},${brush.facing},${this.ship.geometryRevision}`

        if (key === this.hoverKey) return
        this.hoverKey = key

        this.hover?.destroy()
        this.ghost?.destroy()
        this.hover = null
        this.ghost = null
        if (!this.input.pointer.over) return

        this.hover = this.buildHoverBox(col, row, legal)

        // Nothing to preview when destroying or selecting, nothing to promise on a
        // cell that would refuse the block, and nothing to add on one that already
        // holds exactly this - a ghost over an identical block is just a smudge
        const identical = this.matchesBrush(this.ship.layers[brush.layer].get(col, row))
        if (brush.tool === "build" && legal && !identical) this.ghost = this.buildGhost(col, row)
    }

    /** The cell outline, red where the brush would be refused. */
    private buildHoverBox(col: number, row: number, legal: boolean): Mesh {
        return this.buildCellBox(col, row, legal ? HOVER_COLOR : BLOCKED_COLOR, "hover")
    }

    /** One cell's border as four line segments. */
    private buildCellBox(col: number, row: number, color: Color, label: string): Mesh {
        const x = (col - this.origin.x) * CELL
        const y = (row - this.origin.y) * CELL
        const { r, g, b } = color

        const box = [
            x, y, x + CELL, y,
            x + CELL, y, x + CELL, y + CELL,
            x + CELL, y + CELL, x, y + CELL,
            x, y + CELL, x, y,
        ]

        const out: number[] = []
        for (let i = 0; i < box.length; i += 2) out.push(box[i]!, box[i + 1]!, r, g, b)

        return Mesh.create(this.context.gpu, new Float32Array(out), label)
    }

    /**
     * The block a click would place, in its real geometry and orientation.
     *
     * Built through the same displayBlock the layer mesh uses, so a component
     * previews as the hexagon and facing bar it will actually become rather than
     * as whatever hull shape the brush was last holding.
     */
    private buildGhost(col: number, row: number): Mesh | null {
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

        return builder.vertexCount > 0 ? builder.build(this.context.gpu, "ghost") : null
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
    id: "ship-builder",
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
