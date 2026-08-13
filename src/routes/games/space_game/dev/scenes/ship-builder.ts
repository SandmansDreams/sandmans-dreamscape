import { buildShip, findShip, SHIPS } from "../../assets/ships"
import { Ship } from "../../game/ship"
import { shipFromText, shipToText } from "../../game/shipJson"
import { Camera, CameraBinding, type Vec2 } from "../../render/camera"
import { Color } from "../../render/color"
import type { Frame } from "../../render/frame"
import { maxLevel, type ComponentKind } from "../../render/grid/components"
import type { Cell } from "../../render/grid/grid"
import { SHIP_LAYERS, type ShipLayer } from "../../render/grid/layers"
import { appendShape, type BlockShape } from "../../render/grid/shapes"
import { bestThrusterFacing, canPlaceAt } from "../../render/grid/shipLegality"
import { Mesh, MeshBuilder, VERTEX_LAYOUT } from "../../render/mesh"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { Pipeline } from "../../render/webgpu/pipeline"
import { Shader } from "../../render/webgpu/shader"
import type { ActionsOf, SearchColumn, SettingsSchema, ValuesOf } from "../../settings/settings"
import { appendComponentGlyph, appendLayer, displayBlock, isComponent, type BlockLike } from "../../render/grid/blockDraw"
import { loadBrush, saveBrush, type Brush } from "../../render/grid/brush"
import type { DevSceneDefinition } from "../DevScene"
import { downloadText, uploadText } from "../../download"
import { Input } from "../../game/input"

const HOVER_COLOR = Color.from("#ffffff")
const BLOCKED_COLOR = Color.from("#ff5a5a")
const MARK_COLOR = Color.from("#7fe0ff")
const MASS_COLOR = Color.from("#ff8c1a")
const SELECTED_COLOR = Color.from("#00ff40")
const HIGHLIGHT_COLOR = Color.from("#ffe14d")

/** How far the ghost is washed out. 0 is solid, 1 is invisible. */
const GHOST_FADE = 0.72
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
    kind: ComponentKind
    level: number
    maxLevel: number
    turns: number
    mirrored: boolean
    facing: number
    color: string
    hitPoints: number
    mass: number
}

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
        kind: brush.kind,
        level: brush.level,
        facing,
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
function appendMark(out: number[], col: number, row: number, origin: Vec2): void {
    const x = (col - origin.x) * CELL + CELL / 2
    const y = (row - origin.y) * CELL + CELL / 2
    const arm = CELL * 0.22
    const { r, g, b } = MARK_COLOR

    out.push(x - arm, y, r, g, b, x + arm, y, r, g, b)
    out.push(x, y - arm, r, g, b, x, y + arm, r, g, b)
}


class ShipBuilder implements SceneInstance<EditorValues> {
    private readonly context: SceneContext
    private readonly input: Input
    private readonly camera = new Camera()
    private readonly cameraBinding: CameraBinding
    private readonly meshPipeline: Pipeline
    private readonly linePipeline: Pipeline

    private ship = new Ship("untitled", "New Ship")

    // Meshes
    private readonly meshes = new Map<ShipLayer, Mesh>()
    private marks: Mesh | null = null
    private marksKey = ""
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
        clearLayer: () => this.mutate(() => this.ship.layers[this.brush.layer].clear()),
        clearAll: () => this.mutate(() => { for (const grid of this.ship.layersOf()) grid.clear() }),
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
            this.brush = { ...this.brush, ...(value as Partial<Brush>) }
            this.publishBrush()
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

        // Null clears it: the panel sends on enter and again on leave, so the
        // scene never has to guess when a hover ended
        if (key === "highlight") this.highlight = (value as string | null) ?? null
    }

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        this.input = new Input(context.canvas)
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
    }

    update(_dt: number, settings: EditorValues): void {
        this.settings = settings
        // Cheap to set every frame: the setter early-returns when unchanged, and
        // fitCamera already reads gpu.width, so the camera refits itself
        this.context.gpu.resolutionScale = settings.resolution
        this.syncIdentity(settings)

        const [col, row] = this.getGridPositionFromMouse()

        // A snapshot per stroke, not per cell, so one undo reverts a whole drag
        if (this.input.pointer.pressed()) {
            this.pushUndo()

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
        this.rebuildCursor(col, row)
        this.rebuildHighlight()
        this.publishSelection()

        // Last: everything above reads the edges and deltas this clears
        this.input.endFrame()
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

        if (this.ghost) this.ghost.draw(frame)
        if (this.massMark) this.massMark.draw(frame)

        // Lines last, and the legal-cell marks last of all. They are the one thing
        // that has to stay readable over a finished hull, so nothing draws on top.
        frame.setPipeline(this.linePipeline).setBindGroup(0, this.cameraBinding.group)
        if (this.hover) this.hover.draw(frame)
        if (this.highlightBoxes) this.highlightBoxes.draw(frame)
        if (this.selectedBox) this.selectedBox.draw(frame)
        if (this.marks) this.marks.draw(frame)

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

        this.input.destroy()
        for (const mesh of this.meshes.values()) mesh.destroy()
        this.marks?.destroy()
        this.hover?.destroy()
        this.ghost?.destroy()
        this.massMark?.destroy()
        this.selectedBox?.destroy()
        this.highlightBoxes?.destroy()
        this.cameraBinding.destroy()
    }

    /*~~~ Brush ~~~*/

    /** Hands the panel the new brush and schedules the write to storage. */
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
        const key = `${this.highlight ?? ""}|${this.ship.geometryRevision}`
        if (key === this.highlightKey) return
        this.highlightKey = key

        this.highlightBoxes?.destroy()
        this.highlightBoxes = null
        if (!this.highlight) return

        const wanted = this.highlight.toLowerCase()
        const out: number[] = []
        const { r, g, b } = HIGHLIGHT_COLOR

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
    private pickAt(col: number, row: number): { col: number; row: number; layer: ShipLayer } {
        if (this.ship.layers[this.brush.layer].has(col, row)) {
            return { col, row, layer: this.brush.layer }
        }

        for (const layer of [...SHIP_LAYERS].reverse()) {
            if (this.ship.layers[layer].has(col, row)) return { col, row, layer }
        }

        // Nothing there: remember the cell anyway so the panel can say so
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
            ? `${at.layer},${at.col},${at.row},${cell.shape},${cell.kind},${cell.level},${cell.turns},${cell.mirrored},${cell.facing},${cell.color.hex}`
            : ""

        if (key === this.selectionKey) return
        this.selectionKey = key

        // The outline is what ties the info panel to a block on screen - without
        // it the panel describes a cell you have no way to point at
        this.selectedBox?.destroy()
        this.selectedBox = cell && at ? this.buildCellBox(at.col, at.row, SELECTED_COLOR, "selected") : null

        if (!cell || !at) {
            this.context.publish("selected", null)
            return
        }

        const selected: SelectedCell = {
            col: at.col,
            row: at.row,
            layer: at.layer,
            shape: cell.shape,
            kind: cell.kind,
            level: cell.level,
            maxLevel: maxLevel(cell.kind),
            turns: cell.turns,
            mirrored: cell.mirrored,
            facing: cell.facing,
            color: cell.color.hex,
            hitPoints: cell.hitPoints,
            mass: cell.mass,
        }

        this.context.publish("selected", selected)
    }

    /**
     * Re-levels the selected block, clamped to what its kind actually has.
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

        const level = Math.min(maxLevel(cell.kind), Math.max(1, cell.level + delta))
        if (level === cell.level) return

        this.pushUndo()
        grid.set(at.col, at.row, cell.shape, {
            turns: cell.turns,
            mirrored: cell.mirrored,
            kind: cell.kind,
            level,
            facing: cell.facing,
            color: cell.color,
            emission: cell.emission,
        })
    }

    /*~~~ Editing ~~~*/
    private apply(col: number, row: number): void { // NOTE: May need to change to apply to layer?
        const brush = this.brush
        const grid = this.ship.layers[brush.layer]

        // Selecting is what the press already did. Anything else here would make
        // "look at this block" destructive.
        if (brush.tool === "select") return

        if (brush.tool === "erase") {
            grid.delete(col, row)
            return
        }

        // The same call that drew the marks, so what is offered and what is
        // accepted cannot drift apart
        if (!canPlaceAt(this.ship, brush.layer, col, row, brush.kind).ok) return
        if (this.matchesBrush(grid.get(col, row))) return

        grid.set(col, row, brush.shape, {
            turns: brush.turns,
            mirrored: brush.mirrored,
            kind: brush.kind,
            level: Math.min(brush.level, maxLevel(brush.kind)),
            facing: this.facingFor(col, row),
            color: Color.from(brush.color),
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
        return this.brush.kind === "thruster"
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
            && cell.kind === brush.kind
            && cell.level === brush.level
            && cell.facing === brush.facing
            && cell.emission === brush.emission
            && cell.color.hex === brush.color
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
            const builder = new MeshBuilder()
            appendLayer(builder, this.ship.layers[layer], CELL, this.origin)
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
            MASS_COLOR,
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
        const key = `${this.ship.geometryRevision}|${brush.layer}|${brush.kind}|${brush.facing}`
        if (key === this.marksKey) return
        this.marksKey = key

        this.marks?.destroy()
        this.marks = null

        const bounds = this.ship.bounds
        const out: number[] = []

        for (let row = (bounds?.minRow ?? 0) - MARGIN; row <= (bounds?.maxRow ?? 0) + MARGIN; row++) {
            for (let col = (bounds?.minCol ?? 0) - MARGIN; col <= (bounds?.maxCol ?? 0) + MARGIN; col++) {
                if (!canPlaceAt(this.ship, brush.layer, col, row, brush.kind).ok) continue
                appendMark(out, col, row, this.origin)
            }
        }

        if (out.length > 0) {
            this.marks = Mesh.create(this.context.gpu, new Float32Array(out), "legal cells")
        }
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
        const legal = canPlaceAt(this.ship, brush.layer, col, row, brush.kind).ok
        const key = `${col},${row},${this.input.pointer.over},${legal},` +
            `${brush.shape},${brush.turns},${brush.mirrored},${brush.tool},${brush.color},` +
            `${brush.kind},${brush.level},${brush.facing},${this.ship.geometryRevision}`

        if (key === this.hoverKey) return
        this.hoverKey = key

        this.hover?.destroy()
        this.ghost?.destroy()
        this.hover = null
        this.ghost = null
        if (!this.input.pointer.over) return

        this.hover = this.buildHoverBox(col, row, legal)

        // Nothing to preview when erasing or selecting, nothing to promise on a
        // cell that would refuse the block, and nothing to add on one that already
        // holds exactly this - a ghost over an identical block is just a smudge
        const identical = this.matchesBrush(this.ship.layers[brush.layer].get(col, row))
        if (brush.tool === "paint" && legal && !identical) this.ghost = this.buildGhost(col, row)
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
        const brush = this.brush
        const builder = new MeshBuilder()
        const faded = Color.from(brush.color).mix(BACKGROUND, GHOST_FADE)

        const preview = ghostCell(brush, this.facingFor(col, row))
        const { shape, turns, mirrored } = displayBlock(preview)
        const x = (col - this.origin.x) * CELL
        const y = (row - this.origin.y) * CELL

        appendShape(builder, shape, turns, mirrored, x, y, CELL, faded)
        if (isComponent(preview)) {
            appendComponentGlyph(builder, preview, x, y, CELL, faded.mix(BACKGROUND, 0.4))
        }

        return builder.vertexCount > 0 ? builder.build(this.context.gpu, "ghost") : null
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
    builder: true,
    create: (context) => new ShipBuilder(context),
}

export default scene
