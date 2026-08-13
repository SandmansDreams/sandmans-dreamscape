import { downloadText } from "../download"
import { PointerInput } from "../input"
import { appendLayer } from "../blockDraw"
import { Camera, CameraBinding, type Vec2 } from "../../render/camera"
import { Color } from "../../render/color"
import type { Frame } from "../../render/frame"
import { COMPONENT_KINDS, maxLevel, type ComponentKind } from "../../render/grid/components"
import type { Cell } from "../../render/grid/grid"
import { SHIP_LAYERS, type ShipLayer } from "../../render/grid/layers"
import { DRAWN_SHAPES } from "../../render/grid/palette"
import type { BlockShape } from "../../render/grid/shapes"
import { Mesh, MeshBuilder, VERTEX_LAYOUT } from "../../render/mesh"
import { Pipeline } from "../../render/webgpu/pipeline"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { Shader } from "../../render/webgpu/shader"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { Ship } from "../../game/ship"
import { shipFromText, shipToText } from "../../game/shipJson"
import type { ActionsOf, SettingsSchema, ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"
import { DEFAULT_BRUSH, loadBrush, type Brush } from "../brush"
import { canPlaceAt } from "../../render/grid/shipLegality"
import { appendShape } from "../../render/grid/shapes"

const CELL = 32
/** How far the lattice reaches, in cells each way. Panning past it just runs out. */
const LATTICE = 48
/** How far past the hull to offer cells. Two, so a thruster's reach stays visible. */
const MARGIN = 2
/** How far the axes reach, in cells. They only exist to make the origin findable. */
const AXIS_REACH = 64

const FACINGS = ["N", "E", "S", "W"] as const

const HOVER_COLOR = Color.from("#ffffff")
const BLOCKED_COLOR = Color.from("#ff5a5a")
const MARK_COLOR = Color.from("#2f4256")

/** How far the ghost is washed out. 0 is solid, 1 is invisible. */
const GHOST_FADE = 0.72
const BACKGROUND = Color.rgb(0.05, 0.05, 0.07)

const SETTINGS = {
    marks:      { type: "checkbox", label: "Legal cells", default: true },

    shipSep:    { type: "separator", label: "Ship" },
    name:       { type: "text", label: "Name", default: "New Ship" },
    creator:    { type: "text", label: "Creator", default: "SpaceGameCreator" },
    undo:       { type: "button", label: "Undo" },
    redo:       { type: "button", label: "Redo" },
    clearLayer: { type: "button", label: "Clear layer" },
    clearAll:   { type: "button", label: "Clear all" },
    download:   { type: "button", label: "Download" },
    paste:      { type: "text", label: "Paste", default: "", rows: 3,
                  placeholder: "Paste ship JSON, then Load" },
    load:       { type: "button", label: "Load pasted" },
} as const satisfies SettingsSchema

type EditorValues = ValuesOf<typeof SETTINGS>

/** Every cell of every layer, copied. Color is immutable, so it can be shared. */
type Snapshot = Record<ShipLayer, Cell[]>

/** "Scythe Ship" -> "scythe-ship", so a downloaded file drops straight into assets/ships. */
function slug(name: string): string {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return clean === "" ? "untitled" : clean
}

/** A small cross at a cell's center. Line geometry, so it shares the line pipeline. */
function appendMark(out: number[], col: number, row: number, origin: Vec2): void {
    const x = (col - origin.x) * CELL + CELL / 2
    const y = (row - origin.y) * CELL + CELL / 2
    const arm = CELL * 0.12
    const { r, g, b } = MARK_COLOR

    out.push(x - arm, y, r, g, b, x + arm, y, r, g, b)
    out.push(x, y - arm, r, g, b, x, y + arm, r, g, b)
}

class ShipBuilder implements SceneInstance<EditorValues> {
    private readonly context: SceneContext
    private readonly input: PointerInput
    private readonly camera = new Camera()
    private readonly cameraBinding: CameraBinding
    private readonly pipeline: Pipeline
    private readonly lines: Pipeline

    private ship = new Ship("untitled", "New Ship")

    private readonly meshes = new Map<ShipLayer, Mesh>()
    private axes: Mesh | null = null
    private marks: Mesh | null = null
    private marksKey = ""
    private hover: Mesh | null = null
    private ghost: Mesh | null = null

    private brush: Brush = loadBrush()

    private builtRevision = -1
    private hoverKey = ""
    private settings: EditorValues | null = null

    // The origin never moves. The viewer recenters on mass, which in an editor
    // would shift everything already drawn every time you place a block.
    private readonly origin: Vec2 = { x: 0, y: 0 }

    private readonly undoStack: Snapshot[] = []
    private readonly redoStack: Snapshot[] = []

    readonly actions: Record<ActionsOf<typeof SETTINGS>, () => void> = {
        undo: () => this.undo(),
        redo: () => this.redo(),
        clearLayer: () => this.mutate(() => this.ship.layers[this.brush.layer].clear()),
        clearAll: () => this.mutate(() => { for (const grid of this.ship.layersOf()) grid.clear() }),
        download: () => downloadText(`${this.ship.id}.json`, shipToText(this.ship)),
        load: () => this.loadPasted(),
    }

    receive(key: string, value: unknown): void {
        if (key === "brush") this.brush = value as Brush
    }

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        this.input = new PointerInput(context.canvas)
        this.cameraBinding = CameraBinding.create(gpu)

        const shader = Shader.createNow(gpu, MESH_2D, "mesh 2d")
        const layouts = [this.cameraBinding.layout]

        this.pipeline = Pipeline.create(gpu, {
            label: "editor solid", shader, layouts, vertexBuffers: [VERTEX_LAYOUT],
        })
        this.lines = Pipeline.create(gpu, {
            label: "editor lines", shader, layouts, vertexBuffers: [VERTEX_LAYOUT],
            topology: "line-list",
        })

        this.camera.zoom = 1
    }

    update(_dt: number, settings: EditorValues): void {
        this.settings = settings
        this.syncIdentity(settings)

        const world = this.camera.screenToWorld(this.input.x, this.input.y)
        const col = Math.floor(world.x / CELL + this.origin.x)
        const row = Math.floor(world.y / CELL + this.origin.y)

        // A snapshot per stroke, not per cell, so one undo reverts a whole drag
        if (this.input.pressed(0)) this.pushUndo()
        if (this.input.isDown(0) && this.input.over) this.apply(col, row)

        // Divided by zoom so a drag moves the world under the cursor by the same
        // amount whatever the magnification
        if (this.input.isDown(1) || this.input.isDown(2)) {
            this.camera.position.x -= this.input.deltaX / this.camera.zoom
            this.camera.position.y -= this.input.deltaY / this.camera.zoom
        }

        if (this.input.wheel !== 0) {
            this.camera.zoom = Math.min(8, Math.max(0.1, this.camera.zoom * 0.999 ** this.input.wheel))
        }

        if (this.ship.geometryRevision !== this.builtRevision) this.rebuildMeshes()
        this.rebuildMarks()
        this.rebuildCursor(col, row)

        // Last: everything above reads the edges and deltas this clears
        this.input.endFrame()
    }

    /** Keeps the ship's name, creator and filename in step with the fields. */
    private syncIdentity(settings: EditorValues): void {
        if (this.ship.name !== settings.name) {
            this.ship.name = settings.name
            this.ship.id = slug(settings.name)
        }

        if (this.ship.creator !== settings.creator) this.ship.creator = settings.creator
    }

    render(frame: Frame): void {
        const gpu = this.context.gpu
        const settings = this.settings
        if (!settings) return

        this.cameraBinding.upload(this.camera, gpu.width, gpu.height)

        frame.setPipeline(this.lines).setBindGroup(0, this.cameraBinding.group)
        if (settings.marks && this.marks) this.marks.draw(frame)

        frame.setPipeline(this.pipeline).setBindGroup(0, this.cameraBinding.group)
        for (const layer of SHIP_LAYERS) {
            const mesh = this.meshes.get(layer)
            if (mesh) mesh.draw(frame)
        }
        if (this.ghost) this.ghost.draw(frame)

        if (this.hover) {
            frame.setPipeline(this.lines).setBindGroup(0, this.cameraBinding.group)
            this.hover.draw(frame)
        }

        this.context.stats.set("blocks", this.ship.layersOf().reduce((sum, g) => sum + g.size, 0))
        this.context.stats.set("undo depth", this.undoStack.length)
    }

    dispose(): void {
        this.input.destroy()
        for (const mesh of this.meshes.values()) mesh.destroy()
        this.axes?.destroy()
        this.marks?.destroy()
        this.hover?.destroy()
        this.cameraBinding.destroy()
    }

    /*~~~ Editing ~~~*/

        private apply(col: number, row: number): void {
        const brush = this.brush
        const grid = this.ship.layers[brush.layer]

        if (brush.tool === "erase") {
            grid.delete(col, row)
            return
        }

        // The same call that drew the marks, so what is offered and what is
        // accepted cannot drift apart
        if (!canPlaceAt(this.ship, brush.layer, col, row, brush.kind, brush.facing).ok) return
        if (this.matchesBrush(grid.get(col, row))) return

        grid.set(col, row, brush.shape, {
            turns: brush.turns,
            mirrored: brush.mirrored,
            kind: brush.kind,
            level: Math.min(brush.level, maxLevel(brush.kind)),
            facing: brush.facing,
            color: Color.from(brush.color),
            emission: brush.emission,
        })
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

    private loadPasted(): void {
        const text = this.settings?.paste?.trim()
        if (!text) return

        try {
            const { ship, warnings } = shipFromText(text)
            this.pushUndo()
            this.ship = ship
            for (const warning of warnings) console.warn(`ship-editor: ${warning}`)
        } catch (error) {
            console.error("ship-editor: that is not valid JSON.", error)
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

        this.publishPalette()
        this.builtRevision = this.ship.geometryRevision
        this.builtRevision = this.ship.geometryRevision
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
                if (!canPlaceAt(this.ship, brush.layer, col, row, brush.kind, brush.facing).ok) continue
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
        const legal = canPlaceAt(this.ship, brush.layer, col, row, brush.kind, brush.facing).ok
        const key = `${col},${row},${this.input.over},${legal},` +
            `${brush.shape},${brush.turns},${brush.mirrored},${brush.tool},${brush.color}`

        if (key === this.hoverKey) return
        this.hoverKey = key

        this.hover?.destroy()
        this.ghost?.destroy()
        this.hover = null
        this.ghost = null
        if (!this.input.over) return

        this.hover = this.buildHoverBox(col, row, legal)

        // Nothing to preview when erasing, and nothing to promise on a cell that
        // would refuse the block anyway
        if (brush.tool === "paint" && legal) this.ghost = this.buildGhost(col, row)
    }

    /** The cell outline, red where the brush would be refused. */
    private buildHoverBox(col: number, row: number, legal: boolean): Mesh {
        const x = (col - this.origin.x) * CELL
        const y = (row - this.origin.y) * CELL
        const { r, g, b } = legal ? HOVER_COLOR : BLOCKED_COLOR

        const box = [
            x, y, x + CELL, y,
            x + CELL, y, x + CELL, y + CELL,
            x + CELL, y + CELL, x, y + CELL,
            x, y + CELL, x, y,
        ]

        const out: number[] = []
        for (let i = 0; i < box.length; i += 2) out.push(box[i]!, box[i + 1]!, r, g, b)

        return Mesh.create(this.context.gpu, new Float32Array(out), "hover")
    }

    /** The block a click would place, in its real geometry and orientation. */
    private buildGhost(col: number, row: number): Mesh | null {
        const brush = this.brush
        const builder = new MeshBuilder()

        appendShape(
            builder,
            brush.shape,
            brush.turns,
            brush.mirrored,
            (col - this.origin.x) * CELL,
            (row - this.origin.y) * CELL,
            CELL,
            Color.from(brush.color).mix(BACKGROUND, GHOST_FADE),
        )

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