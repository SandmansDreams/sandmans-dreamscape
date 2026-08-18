import { Camera, CameraBinding } from "../../render/camera"
import { DEFAULT_FONT } from "../../render/font"
import type { Frame } from "../../render/frame"
import { Mesh, MeshBuilder, VERTEX_LAYOUT } from "../../render/mesh"
import { Color } from "../../render/color"
import { Pipeline } from "../../render/webgpu/pipeline"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { Shader } from "../../render/webgpu/shader"
import { MESH_2D } from "../../render/shaders/mesh2d"
import { appendShape, MIRRORABLE_SHAPES, turnCount, type BlockShape } from "../../render/grid/shapes"
import { DRAWN_SHAPES, shapeColor } from "../../render/grid/palette"
import { appendBlock, type BlockLike } from "../../render/grid/blockDraw"
import { ART_COMPONENTS, type Component } from "../../render/grid/components"
import type { SettingsSchema, ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition } from "../DevScene"

const SETTINGS = {
    view:    { type: "selection", label: "View", default: "shapes",
               options: ["shapes", "sprites"], display: "segmented" },
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

const BACKDROP_COLOR = Color.rgb(0.10, 0.10, 0.10)
const LABEL_COLOR = Color.rgb(0.60, 0.60, 0.60)

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

/** Widest row label, so the label column fits the longest one. */
function labelColumnWidth(layout: ChartLayout, labels: readonly string[]): number {
    let widest = 0
    for (const label of labels) {
        widest = Math.max(widest, DEFAULT_FONT.measureText(label, layout.fontPixel))
    }
    return widest + layout.columnGap
}

/**
 * A block that exists only to be drawn: one component, at one level and facing.
 *
 * Nothing here is on a ship, so there is no cell to borrow - and inventing a
 * column and a row just to satisfy Cell is what BlockLike exists to avoid. The
 * shape fields are ignored, since a component never draws as its shape.
 */
function spriteBlock(component: Component, level: number, facing: number, color: Color): BlockLike {
    return {
        shape: "full",
        turns: 0,
        mirrored: false,
        type: component.id,
        facing,
        level,
        color,
        // Null keeps whatever the artist chose, which is what a sheet should show
        accentColor: null,
    }
}

/** One row per component per level, since two levels are two pieces of art. */
function spriteRows(): { component: Component; level: number; label: string }[] {
    return ART_COMPONENTS.flatMap((component) =>
        component.levels.map((_, index) => ({
            component,
            level: index + 1,
            label: `${component.id} L${index + 1}`,
        })),
    )
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
    color: Color,
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
    color: Color,
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
        const builder = new MeshBuilder()
        const layout = makeLayout(settings)

        const right = settings.view === "sprites"
            ? this.appendSpriteRows(builder, layout, settings)
            : this.appendShapeRows(builder, layout, settings)

        this.mesh?.destroy()

        if (builder.vertexCount === 0) {
            this.mesh = null
            return
        }

        this.mesh = builder.build(this.context.gpu, "shape chart")
        this.context.stats.set("chart tris", builder.vertexCount / 3)

        const rows = settings.view === "sprites" ? spriteRows().length : DRAWN_SHAPES.length
        const rowStep = blockHeight(layout, settings.mode) + layout.rowGap

        this.bounds = {
            left: 0,
            top: 0,
            right: Math.max(right, 1),
            // Trailing rowGap is not part of the chart
            bottom: Math.max(rowStep + rows * rowStep - layout.rowGap, 1),
        }
    }

    /**
     * One row per shape, at the turns that shape actually has.
     *
     * @returns the chart's right edge
     */
    private appendShapeRows(
        builder: MeshBuilder,
        layout: ChartLayout,
        settings: ChartValues,
    ): number {
        const mode = settings.mode

        const labelWidth = labelColumnWidth(layout, DRAWN_SHAPES)
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

        DRAWN_SHAPES.forEach((shape, index) => {
            const y = firstRowY + index * rowStep
            const color = settings.palette ? shapeColor(shape) : Color.from(settings.color)

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

        return mirroredX + blockW
    }

    /**
     * One row per component per level, four facings across.
     *
     * Facings rather than turns, because that is the axis art actually varies
     * on - appendBlock bakes the quarter turn per facing, and this is the sheet
     * that shows whether a piece still reads pointing all four ways. The key at
     * the top documents the same arrangement; only what the numbers mean changes.
     *
     * @returns the chart's right edge
     */
    private appendSpriteRows(
        builder: MeshBuilder,
        layout: ChartLayout,
        settings: ChartValues,
    ): number {
        const mode = settings.mode
        const rows = spriteRows()

        const labelWidth = labelColumnWidth(layout, rows.map((row) => row.label))
        const blockH = blockHeight(layout, mode)
        const step = layout.cell + layout.gap
        const rowStep = blockH + layout.rowGap

        appendKeyBlock(builder, labelWidth, 0, layout, mode)

        // Always four: a piece of art has no symmetry the chart can know about,
        // so every heading is a state worth looking at
        const arrangement = arrangementFor(mode, 4)
        const ownHeight = arrangement.length * layout.cell + (arrangement.length - 1) * layout.gap
        const offsetY = (blockH - ownHeight) / 2

        // The main tint every piece is painted in, which is how you check a design
        // reads in more than one team colour. `palette` has nothing to key on here
        const color = Color.from(settings.color)

        rows.forEach(({ component, level, label }, index) => {
            const y = rowStep + index * rowStep

            DEFAULT_FONT.appendText(
                builder, label, 0,
                y + (blockH - textHeight(layout.fontPixel)) / 2,
                layout.fontPixel, LABEL_COLOR,
            )

            for (let row = 0; row < arrangement.length; row++) {
                const facings = arrangement[row]!

                for (let column = 0; column < facings.length; column++) {
                    const x = labelWidth + column * step
                    const cellY = y + offsetY + row * step

                    // Backdrop first: there is no depth test, so draw order is the
                    // only thing putting the sprite on top of it
                    builder.quad(x, cellY, layout.cell, layout.cell, BACKDROP_COLOR)
                    appendBlock(
                        builder,
                        spriteBlock(component, level, facings[column]!, color),
                        x, cellY, layout.cell,
                    )
                }
            }
        })

        return labelWidth + blockWidth(layout, mode)
    }
}

const scene: DevSceneDefinition<ChartValues> = {
    id: "shape-chart",
    name: "Shape Chart",
    description:
        "Shapes: every block shape at the turns it actually has - a full block gets one " +
        "cell, a hexagon two, most four - with a second block for the three shapes where " +
        "mirroring is not just another rotation. Sprites: every component's art at all " +
        "four facings, one row per level, painted in the colour picked below. The key at " +
        "the top says which cell is which.",
    settings: SETTINGS,
    create: (context) => new ShapeChart(context),
}

export default scene
