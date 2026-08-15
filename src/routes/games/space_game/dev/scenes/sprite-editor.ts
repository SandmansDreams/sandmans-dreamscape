import { Camera, CameraBinding } from "../../render/camera"
import { Color } from "../../render/color"
import type { Frame } from "../../render/frame"
import { ArtGrid, type ArtCell } from "../../render/grid/artGrid"
import { appendShape, type BlockShape } from "../../render/grid/shapes"
import { ART_LAYERS, ART_ROLES, bakeRole, type ArtLayer, type ArtRole } from "../../render/grid/spriteMesh"
import { FLOATS_PER_VERTEX, Mesh, MeshBuilder, VERTEX_LAYOUT } from "../../render/mesh"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { Pipeline } from "../../render/webgpu/pipeline"
import { Shader } from "../../render/webgpu/shader"
import type { ActionsOf, SettingsSchema, ValuesOf } from "../../settings/settings"
import { artFromText, artToText, emptyArt, ART_GRID, type ComponentArt } from "../../game/componentArt"
import { downloadText, uploadText } from "../../download"
import { Input } from "../../game/input"
import type { DevSceneDefinition } from "../DevScene"

/** World units per authored cell. The whole canvas is CELL * ART_GRID across. */
const CELL = 32

const LATTICE_COLOR = Color.from("#1e2630")
const BORDER_COLOR = Color.from("#5b7fa6")
const HOVER_COLOR = Color.from("#ffffff")
const BLOCKED_COLOR = Color.from("#ff5a5a")

/** How far the ghost is washed out. 0 is solid, 1 is invisible. */
const GHOST_FADE = 0.72

/**
 * How far the layer you are not drawing on is washed out.
 *
 * Enough to tell the two apart at a glance, not so much that you lose the shape
 * you are drawing against - the top layer is usually authored to fit the base.
 */
const IDLE_LAYER_FADE = 0.55
const BACKGROUND = Color.rgb(0.05, 0.05, 0.07)

const SETTINGS = {
    id:       { type: "text", label: "Id", default: "new-part" },
    name:     { type: "text", label: "Name", default: "New Part" },

    viewSep:  { type: "separator", label: "View" },

    baked:    { type: "checkbox", label: "Show baked", default: false },
    lattice:  { type: "checkbox", label: "Grid", default: true },

    fileSep:  { type: "separator", label: "File" },

    clearRole: { type: "button", label: "Clear Role" },
    clearLayer: { type: "button", label: "Clear Layer" },
    clearAll:  { type: "button", label: "Clear All" },
    download:  { type: "button", label: "Download Art" },
    upload:    { type: "button", label: "Upload Art" },
} as const satisfies SettingsSchema

type EditorValues = ValuesOf<typeof SETTINGS>

/**
 * What the sprite editor is about to draw.
 *
 * `mainColor` and `accentColor` are the piece's, not the stroke's - they are on
 * the brush because that is the channel the pickers already speak, and the scene
 * copies them onto the art. Loading a file pushes that piece's colours back the
 * same way, which is what stops the panel showing the previous piece's tints.
 */
export interface ArtBrush {
    /** Which half of the piece is being drawn on. */
    layer: ArtLayer
    role: ArtRole
    tool: "build" | "destroy"
    shape: BlockShape
    turns: number
    mirrored: boolean
    /** The authored colour. Only static squares keep it. */
    color: string
    mainColor: string
    accentColor: string
}

/** What the panel shows about the piece being drawn. */
export interface ArtInfo {
    id: string
    name: string
    grid: number
    /** Authored squares per layer and role. */
    cells: Record<ArtLayer, Record<ArtRole, number>>
    /** Triangles each bakes to, which is the number worth watching. */
    triangles: Record<ArtLayer, Record<ArtRole, number>>
    /** Distinct colours already used by static squares, for re-selecting one. */
    palette: string[]
}

/** Every square of both layers, copied, for one undo step. */
type Snapshot = Record<ArtLayer, ArtCell[]>

/** One mesh per layer-and-role pair, since a Map takes a single key. */
function meshKey(layer: ArtLayer, role: ArtRole): string {
    return `${layer}|${role}`
}

class SpriteEditor implements SceneInstance<EditorValues> {
    private readonly context: SceneContext
    private readonly input: Input
    private readonly camera = new Camera()
    private readonly cameraBinding: CameraBinding
    private readonly meshPipeline: Pipeline
    private readonly linePipeline: Pipeline

    private art: ComponentArt = emptyArt("new-part", "New Part")
    private brush: ArtBrush = {
        layer: "base",
        role: "static",
        tool: "build",
        shape: "full",
        turns: 0,
        mirrored: false,
        color: "#94a1b3",
        mainColor: this.art.mainColor,
        accentColor: this.art.accentColor,
    }

    private readonly meshes = new Map<string, Mesh>()
    private lattice: Mesh | null = null
    private hover: Mesh | null = null
    private ghost: Mesh | null = null

    private builtKey = ""
    private hoverKey = ""
    private settings: EditorValues | null = null

    private lastId = ""
    private lastName = ""

    private readonly undoStack: Snapshot[] = []
    private readonly redoStack: Snapshot[] = []

    private readonly commands: Record<string, () => void> = {
        undo: () => this.undo(),
        redo: () => this.redo(),
        clearRole: () => this.mutate(() => {
            const grid = this.art.layers[this.brush.layer]
            for (const cell of grid.ofRole(this.brush.role)) grid.delete(cell.col, cell.row)
        }),
        clearLayer: () => this.mutate(() => this.art.layers[this.brush.layer].clear()),
        clearAll: () => this.mutate(() => {
            for (const layer of ART_LAYERS) this.art.layers[layer].clear()
        }),
        download: () => downloadText(`${this.art.id}.json`, artToText(this.art)),
        upload: () => uploadText((text) => this.load(text)),
    }

    readonly actions: Record<ActionsOf<typeof SETTINGS>, () => void> = {
        clearRole: () => this.commands.clearRole!(),
        clearLayer: () => this.commands.clearLayer!(),
        clearAll: () => this.commands.clearAll!(),
        download: () => this.commands.download!(),
        upload: () => this.commands.upload!(),
    }

    receive(key: string, value: unknown): void {
        if (key === "artBrush") {
            this.brush = { ...this.brush, ...(value as Partial<ArtBrush>) }

            // The tints belong to the piece; the brush is only how they are edited
            this.art.mainColor = this.brush.mainColor
            this.art.accentColor = this.brush.accentColor

            this.publishBrush()

            // Neither tint touches the grid, so the mesh key would not notice them
            this.builtKey = ""
            return
        }

        if (key === "action") this.commands[value as string]?.()
    }

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        this.input = new Input(context.canvas)
        this.cameraBinding = CameraBinding.create(gpu)

        const shader = Shader.createNow(gpu, MESH_2D, "mesh 2d")
        const layouts = [this.cameraBinding.layout]

        this.meshPipeline = Pipeline.create(gpu, {
            label: "sprite solid", shader, layouts, vertexBuffers: [VERTEX_LAYOUT],
        })
        this.linePipeline = Pipeline.create(gpu, {
            label: "sprite lines", shader, layouts, vertexBuffers: [VERTEX_LAYOUT],
            topology: "line-list",
        })

        this.publishBrush()
    }

    update(_dt: number, settings: EditorValues): void {
        this.settings = settings
        this.syncIdentity(settings)
        this.frameCanvas()

        const [col, row] = this.cellUnderCursor()

        if (this.input.pointer.pressed()) this.pushUndo()
        const drawing = this.input.pointer.pressed() || this.input.pointer.isDown()
        if (drawing && this.input.pointer.over) this.apply(col, row)

        this.rebuildMeshes(settings)
        this.rebuildCursor(col, row)

        this.input.endFrame()
    }

    render(frame: Frame): void {
        const gpu = this.context.gpu
        const settings = this.settings
        if (!settings) return

        this.cameraBinding.upload(this.camera, gpu.width, gpu.height)

        frame.setPipeline(this.meshPipeline).setBindGroup(0, this.cameraBinding.group)
        // Layers outermost so base always draws under top, roles within because
        // each takes its colour differently and has to be uploadable on its own
        for (const layer of ART_LAYERS) {
            for (const role of ART_ROLES) this.meshes.get(meshKey(layer, role))?.draw(frame)
        }
        this.ghost?.draw(frame)

        frame.setPipeline(this.linePipeline).setBindGroup(0, this.cameraBinding.group)
        if (settings.lattice) this.lattice?.draw(frame)
        this.hover?.draw(frame)

        this.context.stats.set("squares", this.squareCount())
    }

    dispose(): void {
        this.input.destroy()
        for (const mesh of this.meshes.values()) mesh.destroy()
        this.lattice?.destroy()
        this.hover?.destroy()
        this.ghost?.destroy()
        this.cameraBinding.destroy()
    }

    /*~~~ Canvas ~~~*/

    /** Always the whole canvas: there is nowhere else to look. */
    private frameCanvas(): void {
        const gpu = this.context.gpu
        const span = ART_GRID * CELL

        this.camera.fit(0, 0, span, span, gpu.width, gpu.height, 0.12)
    }

    private cellUnderCursor(): [col: number, row: number] {
        const world = this.camera.screenToWorld(this.input.pointer.x, this.input.pointer.y)
        return [Math.floor(world.x / CELL), Math.floor(world.y / CELL)]
    }

    private inCanvas(col: number, row: number): boolean {
        return col >= 0 && row >= 0 && col < ART_GRID && row < ART_GRID
    }

    /** Keeps the piece's id and name in step with the fields. */
    private syncIdentity(settings: EditorValues): void {
        if (settings.id !== this.lastId) {
            this.lastId = settings.id
            this.art.id = settings.id
        }

        if (settings.name !== this.lastName) {
            this.lastName = settings.name
            this.art.name = settings.name
        }
    }

    /*~~~ Editing ~~~*/

    /** The colour a square is drawn with, which is the piece's for a tinted role. */
    private colorOf(role: ArtRole, cell: ArtCell | null): Color {
        if (role === "main") return Color.from(this.art.mainColor)
        if (role === "accent") return Color.from(this.art.accentColor)
        return cell ? cell.color : Color.from(this.brush.color)
    }

    /** The canvas being drawn on. Every edit goes through here. */
    private get grid(): ArtGrid {
        return this.art.layers[this.brush.layer]
    }

    private squareCount(): number {
        return ART_LAYERS.reduce((total, layer) => total + this.art.layers[layer].size, 0)
    }

    private apply(col: number, row: number): void {
        if (!this.inCanvas(col, row)) return

        const grid = this.grid

        if (this.brush.tool === "destroy") {
            grid.delete(col, row)
            return
        }

        // A drag revisits a square for many frames; each set() would bump the
        // revision and rebuild every role's mesh
        const existing = grid.get(col, row)
        if (
            existing
            && existing.shape === this.brush.shape
            && existing.turns === this.brush.turns
            && existing.mirrored === this.brush.mirrored
            && existing.role === this.brush.role
            && existing.color.hex === this.brush.color
        ) return

        // One square per position per layer, so painting a main square over a
        // static one replaces it - a square has exactly one role
        grid.set(col, row, this.brush.shape, {
            turns: this.brush.turns,
            mirrored: this.brush.mirrored,
            role: this.brush.role,
            color: Color.from(this.brush.color),
        })
    }

    private snapshot(): Snapshot {
        const snap = {} as Snapshot
        for (const layer of ART_LAYERS) {
            snap[layer] = this.art.layers[layer].list.map((cell) => ({ ...cell }))
        }
        return snap
    }

    private restore(snap: Snapshot): void {
        for (const layer of ART_LAYERS) {
            const grid = this.art.layers[layer]
            grid.clear()
            for (const cell of snap[layer]) {
                grid.set(cell.col, cell.row, cell.shape, { ...cell })
            }
        }
    }

    private pushUndo(): void {
        this.undoStack.push(this.snapshot())
        if (this.undoStack.length > 50) this.undoStack.shift()
        this.redoStack.length = 0
    }

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

    private load(text: string): void {
        try {
            const { art, warnings } = artFromText(text)
            this.pushUndo()
            this.art = art

            // The loaded piece's tints become the brush's, so the pickers show
            // what is actually on screen rather than the previous piece's
            this.brush = {
                ...this.brush,
                mainColor: art.mainColor,
                accentColor: art.accentColor,
            }

            this.publishBrush()
            this.builtKey = ""

            for (const warning of warnings) console.warn(`sprite-editor: ${warning}`)
        } catch (error) {
            console.error("sprite-editor: that file is not valid component art.", error)
        }
    }

    /*~~~ Meshes ~~~*/

    private publishBrush(): void {
        this.context.publish("artBrush", this.brush)
    }

    /** How far a layer's colours are washed out, which is none for the active one. */
    private fadeOf(layer: ArtLayer): number {
        return layer === this.brush.layer ? 0 : IDLE_LAYER_FADE
    }

    /**
     * One mesh per layer and role, plus the lattice.
     *
     * Keyed on both revisions, both tints and the active layer - the tints touch
     * no square, and the active layer changes only how the other one is faded.
     */
    private rebuildMeshes(settings: EditorValues): void {
        const revisions = ART_LAYERS.map((layer) => this.art.layers[layer].revision).join(",")
        const key = `${revisions}|${this.brush.layer}` +
            `|${this.art.mainColor}|${this.art.accentColor}|${settings.baked}`

        if (key === this.builtKey) return
        this.builtKey = key

        this.buildLattice()

        for (const mesh of this.meshes.values()) mesh.destroy()
        this.meshes.clear()

        for (const layer of ART_LAYERS) {
            for (const role of ART_ROLES) {
                const mesh = settings.baked
                    ? this.buildBaked(layer, role)
                    : this.buildAuthored(layer, role)

                if (mesh) this.meshes.set(meshKey(layer, role), mesh)
            }
        }

        this.publishInfo()
    }

    /** The squares as drawn, one shape each. */
    private buildAuthored(layer: ArtLayer, role: ArtRole): Mesh | null {
        const builder = new MeshBuilder()
        const fade = this.fadeOf(layer)

        for (const cell of this.art.layers[layer].ofRole(role)) {
            appendShape(
                builder,
                cell.shape,
                cell.turns,
                cell.mirrored,
                cell.col * CELL,
                cell.row * CELL,
                CELL,
                this.colorOf(role, cell).mix(BACKGROUND, fade),
            )
        }

        return builder.vertexCount > 0
            ? builder.build(this.context.gpu, `art ${layer} ${role}`)
            : null
    }

    /**
     * What the exporter would write, scaled back up to the canvas.
     *
     * The point is to see the merge with your own eyes: if compaction ever ate a
     * gap, this view shows it and the authored view does not.
     */
    private buildBaked(layer: ArtLayer, role: ArtRole): Mesh | null {
        const baked = bakeRole(this.art.layers[layer].ofRole(role), ART_GRID)
        if (baked.length === 0) return null

        const span = ART_GRID * CELL
        const data = new Float32Array(baked)
        const fade = this.fadeOf(layer)
        const tint = this.colorOf(role, null).mix(BACKGROUND, fade)

        // Unit-cell space back to canvas space. A tinted role also has its baked
        // colour replaced, which is exactly what the ship will do to it.
        for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) {
            data[i] = data[i]! * span
            data[i + 1] = data[i + 1]! * span

            if (role === "static" && fade === 0) continue

            // A static square keeps its own hue, so only the fade applies to it
            const baseColor = role === "static"
                ? Color.rgb(data[i + 2]!, data[i + 3]!, data[i + 4]!).mix(BACKGROUND, fade)
                : tint

            data[i + 2] = baseColor.r
            data[i + 3] = baseColor.g
            data[i + 4] = baseColor.b
        }

        return Mesh.create(this.context.gpu, data, `baked ${layer} ${role}`)
    }

    private buildLattice(): void {
        if (this.lattice) return

        const out: number[] = []
        const span = ART_GRID * CELL

        for (let i = 0; i <= ART_GRID; i++) {
            // The outer edge is the hull cell's boundary, the one line that has to
            // stand out - anything past it overhangs a neighbouring cell
            const edge = i === 0 || i === ART_GRID
            const { r, g, b } = edge ? BORDER_COLOR : LATTICE_COLOR
            const at = i * CELL

            out.push(at, 0, r, g, b, at, span, r, g, b)
            out.push(0, at, r, g, b, span, at, r, g, b)
        }

        this.lattice = Mesh.create(this.context.gpu, new Float32Array(out), "art lattice")
    }

    private rebuildCursor(col: number, row: number): void {
        const inside = this.inCanvas(col, row)
        const key = `${col},${row},${this.input.pointer.over},${inside},` +
            `${this.brush.shape},${this.brush.turns},${this.brush.mirrored},` +
            `${this.brush.tool},${this.brush.color},${this.brush.role},${this.brush.layer},` +
            `${this.art.mainColor},${this.art.accentColor}`

        if (key === this.hoverKey) return
        this.hoverKey = key

        this.hover?.destroy()
        this.ghost?.destroy()
        this.hover = null
        this.ghost = null
        if (!this.input.pointer.over) return

        this.hover = this.buildCellBox(col, row, inside ? HOVER_COLOR : BLOCKED_COLOR)
        if (this.brush.tool === "build" && inside) this.ghost = this.buildGhost(col, row)
    }

    private buildCellBox(col: number, row: number, color: Color): Mesh {
        const x = col * CELL
        const y = row * CELL
        const { r, g, b } = color

        const box = [
            x, y, x + CELL, y,
            x + CELL, y, x + CELL, y + CELL,
            x + CELL, y + CELL, x, y + CELL,
            x, y + CELL, x, y,
        ]

        const out: number[] = []
        for (let i = 0; i < box.length; i += 2) out.push(box[i]!, box[i + 1]!, r, g, b)

        return Mesh.create(this.context.gpu, new Float32Array(out), "art hover")
    }

    private buildGhost(col: number, row: number): Mesh | null {
        const builder = new MeshBuilder()

        appendShape(
            builder,
            this.brush.shape,
            this.brush.turns,
            this.brush.mirrored,
            col * CELL,
            row * CELL,
            CELL,
            this.colorOf(this.brush.role, null).mix(BACKGROUND, GHOST_FADE),
        )

        return builder.vertexCount > 0 ? builder.build(this.context.gpu, "art ghost") : null
    }

    /**
     * Every distinct colour a static square is already wearing, in draw order.
     *
     * A Set of hexes rather than of Colors: two Colors that round to the same hex
     * are the same swatch to anyone looking at the panel, and the panel is all
     * this feeds.
     */
    private staticPalette(): string[] {
        const seen = new Set<string>()

        for (const layer of ART_LAYERS) {
            for (const cell of this.art.layers[layer].ofRole("static")) seen.add(cell.color.hex)
        }

        return [...seen]
    }

    private publishInfo(): void {
        const cells = {} as Record<ArtLayer, Record<ArtRole, number>>
        const triangles = {} as Record<ArtLayer, Record<ArtRole, number>>

        // FLOATS_PER_VERTEX * 3 is one triangle, which is the unit worth reporting
        const floatsPerTriangle = FLOATS_PER_VERTEX * 3

        for (const layer of ART_LAYERS) {
            cells[layer] = {} as Record<ArtRole, number>
            triangles[layer] = {} as Record<ArtRole, number>

            for (const role of ART_ROLES) {
                const list = this.art.layers[layer].ofRole(role)
                cells[layer][role] = list.length
                triangles[layer][role] = bakeRole(list, ART_GRID).length / floatsPerTriangle
            }
        }

        this.context.publish("artInfo", {
            id: this.art.id,
            name: this.art.name,
            grid: this.art.grid,
            cells,
            triangles,
            palette: this.staticPalette(),
        } satisfies ArtInfo)
    }
}

const scene: DevSceneDefinition<EditorValues> = {
    id: "sprite-editor",
    name: "Sprite Editor",
    description:
        "Draws one component's art on a 16x16 canvas standing in for a single hull " +
        "cell. Every square is static, main or accent: static keeps the colour you " +
        "gave it, the other two are recoloured by whatever component wears the art.",
    settings: SETTINGS,
    ui: "sprite",
    create: (context) => new SpriteEditor(context),
}

export default scene