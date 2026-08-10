import { Camera, CameraBinding } from "../../render/camera"
import { DEFAULT_FONT } from "../../render/font"
import type { Frame } from "../../render/frame"
import { Mesh, MeshBuilder, VERTEX_LAYOUT, type RGB } from "../../render/mesh"
import { Pipeline } from "../../render/pipeline"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { Shader } from "../../render/shader"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { appendShape, BLOCK_SHAPES, MIRRORABLE_SHAPES, type BlockShape } from "../../render/shapes"
import { hexToRgb, type SettingsSchema, type ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"

const SETTINGS = {
    mode:    { type: "selection", label: "Turns", default: "squares",
               options: ["squares", "lines"], display: "segmented" },
    gap:     { type: "range", label: "Gap", default: 5, min: 0, max: 5, step: 0.05 },
    palette: { type: "checkbox", label: "Per-shape colour", default: false },
    color:   { type: "color", label: "Colour", default: "#7fd4ff" },
} as const satisfies SettingsSchema

type ChartValues = ValuesOf<typeof SETTINGS>
// Inferred from the schema's options - adding a layout there is a compile error
// here until TURN_LAYOUTS has an entry for it
type ChartMode = ChartValues["mode"]

const BACKDROP_COLOR: RGB = [0.10, 0.10, 0.10]
const LABEL_COLOR: RGB = [0.60, 0.60, 0.60]

const SHAPE_COLORS: readonly RGB[] = [
    [0.35, 0.65, 1.00], // blue
    [1.00, 0.55, 0.25], // orange
    [0.45, 0.85, 0.45], // green
    [1.00, 0.45, 0.70], // pink
    [0.95, 0.85, 0.35], // yellow
    [0.35, 0.90, 0.90], // cyan
    [0.70, 0.50, 1.00], // purple
    [1.00, 0.40, 0.40], // red
    [0.30, 0.75, 0.65], // teal
    [0.75, 0.95, 0.35], // lime
    [0.85, 0.65, 0.45], // tan
    [0.60, 0.75, 1.00], // periwinkle
    [0.95, 0.60, 0.85], // magenta
    [0.55, 0.90, 0.70], // mint
]

// "empty" draws nothing, so it would only contribute a blank row
const DRAWN = BLOCK_SHAPES.filter((shape) => shape !== "empty")

/**
 * Where each turn sits inside a block, as rows of cells.
 *
 * "squares" runs clockwise from the top-left starting at turn 2, which points
 * every variant's mass toward the middle - the four turns then close up into a
 * single symmetric figure, so a broken rotation is obvious at a glance.
 * "lines" is the plain left-to-right ordering, easier to compare turn by turn.
 *
 * Adding an arrangement here is the whole change: appendTurnBlock walks whatever
 * grid it is given, ragged rows included.
 */
const TURN_LAYOUTS: Record<ChartMode, readonly (readonly number[])[]> = {
    squares: [
        [2, 3], // top-left,    top-right
        [1, 0], // bottom-left, bottom-right
    ],
    lines: [
        [0, 1, 2, 3],
    ],
}

/**
 * Every measurement the chart needs, in abstract units.
 *
 * Not pixels: the camera fits the finished bounds to the viewport, so only the
 * ratios matter. Deriving the font sizes from `cell` keeps labels proportionate
 * as the cell slider moves.
 */
interface ChartLayout {
    cell: number
    gap: number       // between cells inside a block
    columnGap: number // between the label column and the blocks
    rowGap: number    // between shape rows
    fontPixel: number
    headerPixel: number
    turns: readonly (readonly number[])[]
}

function makeLayout(values: ChartValues): ChartLayout {
    const cell = 5

    return {
        cell,
        gap: values.gap,
        columnGap: cell * 0.4,
        rowGap: values.gap * 2,
        fontPixel: cell / 20,
        headerPixel: cell / 12,
        turns: TURN_LAYOUTS[values.mode],
    }
}

/*~~~ Measuring ~~~*/

function isMirrorable(shape: BlockShape): boolean {
    return MIRRORABLE_SHAPES.includes(shape)
}

/** Cells across the widest row of the arrangement. */
function blockColumns(layout: ChartLayout): number {
    let widest = 0
    for (const row of layout.turns) widest = Math.max(widest, row.length)
    return widest
}

function blockWidth(layout: ChartLayout): number {
    const columns = blockColumns(layout)
    return columns * layout.cell + (columns - 1) * layout.gap
}

function blockHeight(layout: ChartLayout): number {
    const rows = layout.turns.length
    return rows * layout.cell + (rows - 1) * layout.gap
}

function textHeight(pixel: number): number {
    return DEFAULT_FONT.glyphHeight * pixel
}

/** Widest shape name, so the label column fits the longest one at any cell size. */
function labelColumnWidth(layout: ChartLayout): number {
    let widest = 0
    for (const shape of DRAWN) {
        widest = Math.max(widest, DEFAULT_FONT.measureText(shape, layout.fontPixel))
    }
    return widest + layout.columnGap
}

/*~~~ Emitting ~~~*/

function appendCell(
    builder: MeshBuilder,
    shape: BlockShape,
    turns: number,
    mirrored: boolean,
    x: number,
    y: number,
    layout: ChartLayout,
    color: RGB,
): void {
    // Backdrop first so the shape lands on top - there is no depth test, so draw
    // order is the only thing deciding this
    builder.quad(x, y, layout.cell, layout.cell, BACKDROP_COLOR)
    appendShape(builder, shape, turns, mirrored, x, y, layout.cell, color)
}

/** All four turns, positioned by whichever arrangement the layout carries. */
function appendTurnBlock(
    builder: MeshBuilder,
    shape: BlockShape,
    mirrored: boolean,
    x: number,
    y: number,
    layout: ChartLayout,
    color: RGB,
): void {
    const step = layout.cell + layout.gap

    for (let row = 0; row < layout.turns.length; row++) {
        const cells = layout.turns[row]!
        for (let column = 0; column < cells.length; column++) {
            appendCell(
                builder, shape, cells[column]!, mirrored,
                x + column * step, y + row * step,
                layout, color,
            )
        }
    }
}

/**
 * A block-shaped key showing which turn sits in which cell.
 *
 * One legend for the whole chart rather than a number on every cell: in "lines"
 * the order is obvious, but "squares" is 2,3 over 1,0 and would otherwise be
 * something you have to remember.
 */
function appendKeyBlock(builder: MeshBuilder, x: number, y: number, layout: ChartLayout): void {
    const step = layout.cell + layout.gap
    const pixel = layout.headerPixel

    for (let row = 0; row < layout.turns.length; row++) {
        const cells = layout.turns[row]!
        for (let column = 0; column < cells.length; column++) {
            const cellX = x + column * step
            const cellY = y + row * step
            builder.quad(cellX, cellY, layout.cell, layout.cell, BACKDROP_COLOR)

            const text = String(cells[column])
            DEFAULT_FONT.appendText(
                builder,
                text,
                cellX + (layout.cell - DEFAULT_FONT.measureText(text, pixel)) / 2,
                cellY + (layout.cell - textHeight(pixel)) / 2,
                pixel,
                LABEL_COLOR,
            )
        }
    }
}

class ShapeChart implements SceneInstance<ChartValues> {
    private readonly context: SceneContext
    private readonly camera = new Camera()
    private readonly cameraBinding: CameraBinding
    private readonly pipeline: Pipeline

    private mesh: Mesh | null = null
    private bounds = { left: 0, top: 0, right: 1, bottom: 1 }
    private builtKey = ""

    constructor(context: SceneContext) {
        this.context = context
        const gpu = context.gpu

        const shader = Shader.createNow(gpu, MESH_2D, "mesh 2d")
        this.cameraBinding = CameraBinding.create(gpu)

        this.pipeline = Pipeline.create(gpu, {
            label: "shape chart",
            shader,
            layouts: [this.cameraBinding.layout],
            vertexBuffers: [VERTEX_LAYOUT],
        })
    }

    update(_dt: number, settings: ChartValues): void {
        const key = `${DEFAULT_FONT.loaded}|${JSON.stringify(settings)}`
        if (key === this.builtKey) return

        this.rebuild(settings)
        this.builtKey = key
    }

    render(frame: Frame): void {
        if (!this.mesh) return
        const gpu = this.context.gpu

        const { left, top, right, bottom } = this.bounds
        this.camera.fit(left, top, right, bottom, gpu.width, gpu.height)
        this.cameraBinding.upload(this.camera, gpu.width, gpu.height)

        frame.setPipeline(this.pipeline).setBindGroup(0, this.cameraBinding.group)
        this.mesh.draw(frame)
    }

    dispose(): void {
        this.mesh?.destroy()
        this.cameraBinding.destroy()
    }

    private rebuild(settings: ChartValues): void {
        const layout = makeLayout(settings)
        const builder = new MeshBuilder()

        const labelWidth = labelColumnWidth(layout)
        const blockW = blockWidth(layout)
        const blockH = blockHeight(layout)
        const mirroredX = labelWidth + blockW + layout.gap

        // Header: the turn key, plus a caption over the mirrored column
        appendKeyBlock(builder, labelWidth, 0, layout)
        DEFAULT_FONT.appendText(
            builder, "mirrored", mirroredX,
            (blockH - textHeight(layout.headerPixel)) / 2,
            layout.headerPixel, LABEL_COLOR,
        )

        const rowStep = blockH + layout.rowGap
        const firstRowY = rowStep

        DRAWN.forEach((shape, index) => {
            const y = firstRowY + index * rowStep
            const color = settings.palette
                ? SHAPE_COLORS[index % SHAPE_COLORS.length]!
                : hexToRgb(settings.color)

            // Label sits on the block's vertical centre rather than its top edge
            DEFAULT_FONT.appendText(
                builder, shape, 0,
                y + (blockH - textHeight(layout.fontPixel)) / 2,
                layout.fontPixel, LABEL_COLOR,
            )

            appendTurnBlock(builder, shape, false, labelWidth, y, layout, color)

            // A full second block of all four turns - mirroring composes with
            // rotation, so showing one variant would hide three of the four states
            if (isMirrorable(shape)) {
                appendTurnBlock(builder, shape, true, mirroredX, y, layout, color)
            }
        })

        this.mesh?.destroy()

        if (builder.vertexCount === 0) {
            this.mesh = null
            return
        }

        this.mesh = builder.build(this.context.gpu, "shape chart")
        this.context.stats.set("chart tris", builder.vertexCount / 3)

        this.bounds = {
            left: 0,
            top: 0,
            right: Math.max(mirroredX + blockW, 1),
            // Trailing rowGap is not part of the chart
            bottom: Math.max(firstRowY + DRAWN.length * rowStep - layout.rowGap, 1),
        }
    }
}

const scene: DevSceneDefinition<ChartValues> = {
    id: "shape-chart",
    name: "Shape Chart",
    description:
        "Every block shape at all four turns, with a second four-turn block for the three " +
        "shapes where mirroring is not just another rotation. The key block at the top says " +
        "which cell is which turn.",
    settings: SETTINGS,
    create: (context) => new ShapeChart(context),
}

export default scene