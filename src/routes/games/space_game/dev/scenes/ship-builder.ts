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

const CELL = 32
/** How far the lattice reaches, in cells each way. Panning past it just runs out. */
const LATTICE = 48

const FACINGS = ["N", "E", "S", "W"] as const

const GRID_COLOR = Color.from("#1e2630")
const AXIS_COLOR = Color.from("#39485c")
const HOVER_COLOR = Color.from("#ffffff")

const SETTINGS = {
    layer:      { type: "selection", label: "Layer", default: "hull",
                  options: SHIP_LAYERS, display: "segmented" },
    tool:       { type: "selection", label: "Tool", default: "paint",
                  options: ["paint", "erase"], display: "segmented" },
    shape:      { type: "selection", label: "Shape", default: "full", options: DRAWN_SHAPES },
    turns:      { type: "range", label: "Turns", default: 0, min: 0, max: 3, step: 1 },
    mirrored:   { type: "checkbox", label: "Mirrored", default: false },
    kind:       { type: "selection", label: "Kind", default: "hull", options: COMPONENT_KINDS },
    level:      { type: "range", label: "Level", default: 1, min: 1, max: 3, step: 1 },
    facing:     { type: "selection", label: "Facing", default: "N",
                  options: FACINGS, display: "segmented" },
    color:      { type: "color", label: "Color", default: "#94a1b3" },
    lattice:    { type: "checkbox", label: "Grid", default: true },

    shipSep:    { type: "separator", label: "Ship" },
    name:       { type: "text", label: "Name", default: "New Ship" },
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

class ShipBuilder implements SceneInstance<EditorValues> {
    private readonly context: SceneContext
    private readonly input: PointerInput
    private readonly camera = new Camera()
    private readonly cameraBinding: CameraBinding
    private readonly pipeline: Pipeline
    private readonly lines: Pipeline

    private ship = new Ship("untitled", "New Ship")

    private readonly meshes = new Map<ShipLayer, Mesh>()
    private lattice: Mesh | null = null
    private hover: Mesh | null = null

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
        clearLayer: () => this.mutate(() => this.ship.layers[this.settings?.layer ?? "hull"].clear()),
        clearAll: () => this.mutate(() => { for (const grid of this.ship.layersOf()) grid.clear() }),
        download: () => downloadText(`${this.ship.id}.json`, shipToText(this.ship)),
        load: () => this.loadPasted(),
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
        if (this.ship.name !== settings.name) this.ship.name = settings.name

        const world = this.camera.screenToWorld(this.input.x, this.input.y)
        const col = Math.floor(world.x / CELL + this.origin.x)
        const row = Math.floor(world.y / CELL + this.origin.y)

        // A snapshot per stroke, not per cell, so one undo reverts a whole drag
        if (this.input.pressed(0)) this.pushUndo()
        if (this.input.isDown(0) && this.input.over) this.apply(col, row, settings)

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
        this.rebuildOverlay(col, row, settings)

        // Last: everything above reads the edges and deltas this clears
        this.input.endFrame()
    }

    render(frame: Frame): void {
        const gpu = this.context.gpu
        const settings = this.settings
        if (!settings) return

        this.cameraBinding.upload(this.camera, gpu.width, gpu.height)

        if (settings.lattice && this.lattice) {
            frame.setPipeline(this.lines).setBindGroup(0, this.cameraBinding.group)
            this.lattice.draw(frame)
        }

        frame.setPipeline(this.pipeline).setBindGroup(0, this.cameraBinding.group)
        for (const layer of SHIP_LAYERS) {
            const mesh = this.meshes.get(layer)
            if (mesh) mesh.draw(frame)
        }

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
        this.lattice?.destroy()
        this.hover?.destroy()
        this.cameraBinding.destroy()
    }

    /*~~~ Editing ~~~*/

    private apply(col: number, row: number, settings: EditorValues): void {
        const grid = this.ship.layers[settings.layer]

        if (settings.tool === "erase") {
            grid.delete(col, row)
            return
        }

        const existing = grid.get(col, row)
        const kind = settings.kind as ComponentKind

        // Skip an identical repaint: a drag revisits the same cell for many
        // frames, and each set() would bump geometryRevision and re-tessellate
        if (
            existing &&
            existing.shape === settings.shape &&
            existing.mirrored === settings.mirrored &&
            existing.kind === kind &&
            existing.level === settings.level &&
            existing.color.hex === settings.color
        ) return

        grid.set(col, row, settings.shape as BlockShape, {
            turns: settings.turns,
            mirrored: settings.mirrored,
            kind,
            level: Math.min(settings.level, maxLevel(kind)),
            facing: FACINGS.indexOf(settings.facing as (typeof FACINGS)[number]),
            color: Color.from(settings.color),
        })
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

        this.builtRevision = this.ship.geometryRevision
    }

    /** The lattice and the hover box, both line geometry. */
    private rebuildOverlay(col: number, row: number, settings: EditorValues): void {
        const gpu = this.context.gpu

        if (!this.lattice) {
            const out: number[] = []
            const span = LATTICE * CELL

            for (let i = -LATTICE; i <= LATTICE; i++) {
                // The axes get their own color, so the origin is findable after a pan
                const color = i === 0 ? AXIS_COLOR : GRID_COLOR
                const at = i * CELL

                out.push(at, -span, color.r, color.g, color.b, at, span, color.r, color.g, color.b)
                out.push(-span, at, color.r, color.g, color.b, span, at, color.r, color.g, color.b)
            }

            this.lattice = Mesh.create(gpu, new Float32Array(out), "lattice")
        }

        const key = `${col},${row},${this.input.over}`
        if (key === this.hoverKey) return
        this.hoverKey = key

        this.hover?.destroy()
        this.hover = null
        if (!this.input.over) return

        const x = (col - this.origin.x) * CELL
        const y = (row - this.origin.y) * CELL
        const { r, g, b } = HOVER_COLOR

        const box = [
            x, y, x + CELL, y,
            x + CELL, y, x + CELL, y + CELL,
            x + CELL, y + CELL, x, y + CELL,
            x, y + CELL, x, y,
        ]

        const out: number[] = []
        for (let i = 0; i < box.length; i += 2) out.push(box[i]!, box[i + 1]!, r, g, b)

        this.hover = Mesh.create(gpu, new Float32Array(out), "hover")
    }
}

const scene: DevSceneDefinition<EditorValues> = {
    id: "ship-builder",
    name: "Ship Builder",
    description:
        "Left drag paints, right or middle drag pans, wheel zooms. The brush is the " +
        "settings below. Undo covers a whole stroke, not a single block.",
    settings: SETTINGS,
    create: (context) => new ShipBuilder(context),
}

export default scene