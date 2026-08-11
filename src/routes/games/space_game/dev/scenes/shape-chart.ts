import { Camera, CameraBinding } from "../../render/camera"
import { DEFAULT_FONT } from "../../render/font"
import type { Frame } from "../../render/frame"
import { Mesh, MeshBuilder, VERTEX_LAYOUT, type RGB } from "../../render/mesh"
import { Pipeline } from "../../render/webgpu/pipeline"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { Shader } from "../../render/webgpu/shader"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { appendShape, MIRRORABLE_SHAPES, turnCount, type BlockShape } from "../../render/grid/shapes"
import { DRAWN_SHAPES, shapeColor } from "../../render/grid/palette"
import { hexToRgb, type SettingsSchema, type ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"

const SETTINGS = {
    mode:    { type: "selection", label: "Turns", default: "squares",
               options: ["squares", "lines"], display: "segmented" },
    gap:     { type: "range", label: "Gap", default: 5, min: 0, max: 5, step: 0.05 },
    palette: { type: "checkbox", label: "Per-shape color", default: false },
    color:   { type: "color", label: "Color", default: "#7fd4ff" },
} as const satisfies SettingsSchema

type ChartValues = ValuesOf<typeof SETTINGS>
// Inferred from the schema's options - adding a layout there is a compile error
// in arrangementFor until it handles the new mode
type ChartMode = ChartValues["mode"]

const BACKDROP_COLOR: RGB = [0.10, 0.10, 0.10]
const LABEL_COLOR: RGB = [0.60, 0.60, 0.60]

// Shared with the shape-test ship, so a block here and the same block there are
// always the same color
const DRAWN = DRAWN_SHAPES

/** One turn's position inside a block, as rows of turn numbers. */
type Arrangement = readonly (readonly number[])[]

/**
 * Where each turn sits inside a block, given how many turns the shape has.
 *
 * "squares" runs clockwise from the top-left starting at turn 2, which points
 * every variant's mass toward the middle - the four turns then close up into a
 * single symmetric figure, so a broken rotation is obvious at a glance. With
 * fewer than four turns there is no square to make, so it falls back to a line.
 */
function arrangementFor(mode: ChartMode, count: number): Arrangement {
    if (mode === "squares" && count === 4) {
        return [
            [2, 3], // top-left,    top-right
            [1, 0], // bottom-left, bottom-right
        ]
    }
    return [Array.from({ length: count }, (_, turns) => turns)]
}

/**
 * Every measurement the chart needs, in abstract units.
 *
 * Not pixels: the camera fits the finished bounds to the viewport, so only the
 * ratios matter.
 */
interface ChartLayout {
    cell: number
    gap: number       // between cells inside a block
    blockGap: number  // between the plain and mirrored blocks
    columnGap: number // between the label column and the blocks
    rowGap: number    // between shape rows
    fontPixel: number
    headerPixel: number
}

function makeLayout(values: ChartValues): ChartLayout {
    const cell = 5

    return {
        cell,
        gap: values.gap,
        blockGap: cell * 0.6,
        columnGap: cell * 0.4,
        rowGap: values.gap * 2,
        fontPixel: cell / 20,
        headerPixel: cell / 12,
    }
}

/*~~~ Measuring ~~~*/

function isMirrorable(shape: BlockShape): boolean {
    return MIRRORABLE_SHAPES.includes(shape)
}

/**
 * The block footprint is sized for a four-turn shape whatever the row holds.
 *
 * Shapes with fewer turns draw fewer cells into the same box, so turn 0 stays at
 * the same x on every row and the columns can be read straight down.
 */
function maxBlockColumns(mode: ChartMode): number {
    return mode === "squares" ? 2 : 4
}

function maxBlockRows(mode: ChartMode): number {
    return mode === "squares" ? 2 : 1
}

function blockWidth(layout: ChartLayout, mode: ChartMode): number {
    const columns = maxBlockColumns(mode)
    return columns * layout.cell + (columns - 1) * layout.gap
}

function blockHeight(layout: ChartLayout, mode: ChartMode): number {
    const rows = maxBlockRows(mode)
    return rows * layout.cell + (rows - 1) * layout.gap
}

function textHeight(pixel: number): number {
    return DEFAULT_FONT.glyphHeight * pixel
}

/** Widest shape name, so the label column fits the longest one. */
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

/**
 * One block of turns, laid out by `arrangement`.
 *
 * Vertically centered in the row's full block height, so a one-turn shape sits
 * on the same line as its neighbours instead of floating at the top.
 */
function appendTurnBlock(
    builder: MeshBuilder,
    shape: BlockShape,
    mirrored: boolean,
    x: number,
    y: number,
    layout: ChartLayout,
    mode: ChartMode,
    arrangement: Arrangement,
    color: RGB,
): void {
    const step = layout.cell + layout.gap
    const ownHeight = arrangement.length * layout.cell + (arrangement.length - 1) * layout.gap
    const offsetY = (blockHeight(layout, mode) - ownHeight) / 2

    for (let row = 0; row < arrangement.length; row++) {
        const cells = arrangement[row]!
        for (let column = 0; column < cells.length; column++) {
            appendCell(
                builder, shape, cells[column]!, mirrored,
                x + column * step, y + offsetY + row * step,
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
 * something you have to remember. Always drawn at the full four turns, since it
 * is documenting the scheme rather than any one shape.
 */
function appendKeyBlock(
    builder: MeshBuilder,
    x: number,
    y: number,
    layout: ChartLayout,
    mode: ChartMode,
): void {
    const step = layout.cell + layout.gap
    const pixel = layout.headerPixel
    const arrangement = arrangementFor(mode, 4)

    for (let row = 0; row < arrangement.length; row++) {
        const cells = arrangement[row]!
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
        const mode = settings.mode
        const builder = new MeshBuilder()

        const labelWidth = labelColumnWidth(layout)
        const blockW = blockWidth(layout, mode)
        const blockH = blockHeight(layout, mode)
        const mirroredX = labelWidth + blockW + layout.blockGap

        // Header: the turn key, plus a caption over the mirrored column
        appendKeyBlock(builder, labelWidth, 0, layout, mode)
        DEFAULT_FONT.appendText(
            builder, "mirrored", mirroredX,
            (blockH - textHeight(layout.headerPixel)) / 2,
            layout.headerPixel, LABEL_COLOR,
        )

        const rowStep = blockH + layout.rowGap
        const firstRowY = rowStep

        DRAWN.forEach((shape, index) => {
            const y = firstRowY + index * rowStep
            const color = settings.palette ? shapeColor(shape) : hexToRgb(settings.color)

            // Only the turns this shape actually has: a `full` block is identical
            // at every turn, so drawing four of it would claim four variants exist
            const arrangement = arrangementFor(mode, turnCount(shape))

            // Label sits on the block's vertical center rather than its top edge
            DEFAULT_FONT.appendText(
                builder, shape, 0,
                y + (blockH - textHeight(layout.fontPixel)) / 2,
                layout.fontPixel, LABEL_COLOR,
            )

            appendTurnBlock(builder, shape, false, labelWidth, y, layout, mode, arrangement, color)

            // A full second block - mirroring composes with rotation, so showing one
            // variant would hide the rest of the states
            if (isMirrorable(shape)) {
                appendTurnBlock(builder, shape, true, mirroredX, y, layout, mode, arrangement, color)
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
        "Every block shape at the turns it actually has - a full block gets one cell, a " +
        "hexagon two, most four - with a second block for the three shapes where mirroring " +
        "is not just another rotation. The key at the top says which cell is which turn.",
    settings: SETTINGS,
    create: (context) => new ShapeChart(context),
}

export default scene
