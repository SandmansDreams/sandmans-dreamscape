import { Camera } from "../../../render/camera";
import { DEFAULT_FONT } from "../../../render/font";
import { Mesh } from "../../../render/mesh";
import { MINIMAL_2D_FRAGMENT_SOURCE, MINIMAL_2D_VERTEX_SOURCE, Program, Shader } from "../../../render/shaders";
import { appendShape, BLOCK_SHAPES, type BlockShape, MIRRORABLE_SHAPES } from "../../../render/shapes";
import type { SettingsSchema, ValuesOf } from "../../../settings/settings";
import type { SceneContext, SceneInstance } from "../../../render/scenes";
import type { DevSceneDefinition } from "../DevScene";

const SETTINGS = {
    resolution: { type: "range", label: "Resolution",    default: 1,   min: 0.05,  max: 1,  step: 0.05 },
    rows:    { type: "range", label: "Rows",    default: 6,   min: 1,  max: 13,  step: 1 },
    gap:     { type: "range", label: "Gap",     default: 5,   min: 0,  max: 40,  step: 1 },
    mode:    { type: "selection", label: "Mode", default: "squares", options: ["lines", "squares"]},
} as const satisfies SettingsSchema

type ChartValues = ValuesOf<typeof SETTINGS>
type ChartMode = ChartValues["mode"] // inferred from the schema's options

type Color = readonly [number, number, number]

const BACKDROP_COLOR: Color = [0.10, 0.10, 0.10]
const LABEL_COLOR: Color = [0.55, 0.60, 0.65]
const CELL = 40

const SHAPE_COLORS: Color[] = [
    [0.35, 0.65, 1.00],   // blue
    [1.00, 0.55, 0.25],   // orange
    [0.45, 0.85, 0.45],   // green
    [1.00, 0.45, 0.70],   // pink
    [0.95, 0.85, 0.35],   // yellow
    [0.35, 0.90, 0.90],   // cyan
    [0.70, 0.50, 1.00],   // purple
    [1.00, 0.40, 0.40],   // red
    [0.30, 0.75, 0.65],   // teal
    [0.75, 0.95, 0.35],   // lime
    [0.85, 0.65, 0.45],   // tan
    [0.60, 0.75, 1.00],   // periwinkle
    [0.95, 0.60, 0.85],   // magenta
    [0.55, 0.90, 0.70],   // mint
]

/**
 * Where each turn sits inside a block, as rows of cells.
 *
 * "squares" runs clockwise from the top-left starting at turn 2, which points
 * every variant's mass toward the middle - the four turns then close up into a
 * single symmetric figure, so a broken rotation is obvious at a glance.
 * "lines" is the plain left-to-right ordering, easier to compare turn by turn.
 *
 * Adding an arrangement here is the whole change: appendTurnBlock just walks
 * whatever grid it is given, ragged rows included.
 */
const TURN_LAYOUTS: Record<ChartMode, readonly (readonly number[])[]> = {
    squares: [
        [2, 3],  // top-left,    top-right
        [1, 0],  // bottom-left, bottom-right
    ],
    lines: [
        [0, 1, 2, 3],
    ],
}

/**
 * Every measurement the chart needs, in abstract units.
 *
 * Not pixels: the camera fits the finished bounds to the viewport, so only the
 * ratios between these matter. Deriving the font size from `cell` keeps labels
 * proportionate when the cell setting changes.
 */
interface ChartLayout {
    cell: number       // side of one turn's cell
    gap: number        // between the cells inside a block
    blockGap: number   // between the plain and mirrored blocks
    columnGap: number  // between groups, horizontally
    rowGap: number     // between groups, vertically
    labelGap: number   // between a label and the block under it
    fontPixel: number
    rows: number       // how many rows of groups to spread the shapes over
    turns: readonly (readonly number[])[] // the chosen arrangement
}

function makeLayout(values: ChartValues): ChartLayout {
    const cell = CELL
    const gap = values.gap

    return {
        cell,
        gap,
        blockGap: gap * 3,
        columnGap: cell * 0.5,
        rowGap: cell * 0.4,
        labelGap: cell * 0.1,
        fontPixel: cell / 20,
        rows: values.rows,
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

function labelHeight(layout: ChartLayout): number {
    return DEFAULT_FONT.glyphHeight * layout.fontPixel
}

/** One block, or two side by side when the shape is mirrorable. */
function blocksWidth(shape: BlockShape, layout: ChartLayout): number {
    const width = blockWidth(layout)
    return isMirrorable(shape) ? width * 2 + layout.blockGap : width
}

function groupWidth(shape: BlockShape, layout: ChartLayout): number {
    return Math.max(blocksWidth(shape, layout), DEFAULT_FONT.measureText(shape, layout.fontPixel))
}

function groupHeight(layout: ChartLayout): number {
    return labelHeight(layout) + layout.labelGap + blockHeight(layout)
}

/*~~~ Drawing, smallest piece first ~~~*/

/** The dark square a shape is painted onto, so empty cells are still visible. */
function appendBackdrop(
    out: number[],
    left: number, top: number, right: number, bottom: number,
    [r, g, b]: Color
) {
    out.push(
        left, top, r, g, b,
        right, top, r, g, b,
        right, bottom, r, g, b,

        left, top, r, g, b,
        right, bottom, r, g, b,
        left, bottom, r, g, b
    )
}

/** One turn: its backdrop, with the shape painted over it. */
function appendCell(
    out: number[],
    shape: BlockShape, turn: number, mirrored: boolean,
    x: number, y: number,
    layout: ChartLayout, color: Color
) {
    // Backdrop first - there is no depth test, so later triangles simply cover
    // earlier ones.
    appendBackdrop(out, x, y, x + layout.cell, y + layout.cell, BACKDROP_COLOR)
    appendShape(out, shape, turn, mirrored, x, y, layout.cell, ...color)
}

/** All four turns, positioned by whichever arrangement the layout carries. */
function appendTurnBlock(
    out: number[],
    shape: BlockShape, mirrored: boolean,
    x: number, y: number,
    layout: ChartLayout, color: Color
) {
    const step = layout.cell + layout.gap

    for (let row = 0; row < layout.turns.length; row++) {
        for (let col = 0; col < layout.turns[row].length; col++) {
            appendCell(
                out,
                shape, layout.turns[row][col], mirrored,
                x + col * step,
                y + row * step,
                layout, color
            )
        }
    }
}

/** A labelled group: the shape's name, its block, and a mirrored block if it has one. */
function appendGroup(
    out: number[],
    shape: BlockShape,
    x: number, y: number,
    layout: ChartLayout, color: Color
) {
    DEFAULT_FONT.appendText(out, shape, x, y, layout.fontPixel, ...LABEL_COLOR)

    const blockY = y + labelHeight(layout) + layout.labelGap
    appendTurnBlock(out, shape, false, x, blockY, layout, color)

    if (!isMirrorable(shape)) return

    const mirroredX = x + blockWidth(layout) + layout.blockGap

    // Right-aligned against the mirrored block, so a long shape name like
    // HALFWEDGE cannot run into it.
    const marker = "M"
    DEFAULT_FONT.appendText(
        out, marker,
        mirroredX + blockWidth(layout) - DEFAULT_FONT.measureText(marker, layout.fontPixel),
        y,
        layout.fontPixel, ...LABEL_COLOR
    )

    appendTurnBlock(out, shape, true, mirroredX, blockY, layout, color)
}

/** Every shape, laid out in a grid of groups. */
function buildChart(layout: ChartLayout) {
    const out: number[] = [] // interleaved [x, y, r, g, b]

    // One step for every group, so the columns line up even though mirrorable
    // shapes are twice as wide.
    let stepX = 0
    for (const shape of BLOCK_SHAPES) stepX = Math.max(stepX, groupWidth(shape, layout))
    stepX += layout.columnGap

    const stepY = groupHeight(layout) + layout.rowGap

    // Every row count from 1 to the shape count has to give exactly that many
    // rows. Deriving a single column count instead would collapse several
    // settings onto the same layout - with 13 shapes, ceil(13/n) is 2 for every
    // n from 7 to 12, so the slider would appear to snap.
    const total = BLOCK_SHAPES.length
    const rows = Math.max(1, Math.min(Math.floor(layout.rows), total))

    // Spread the shapes across those rows, the first `remainder` rows taking
    // one extra so no two rows differ by more than one.
    const perRow = Math.floor(total / rows)
    const remainder = total % rows

    let index = 0
    let widestRow = 0

    for (let row = 0; row < rows; row++) {
        const count = perRow + (row < remainder ? 1 : 0)
        widestRow = Math.max(widestRow, count)

        for (let col = 0; col < count; col++) {
            appendGroup(
                out,
                BLOCK_SHAPES[index],
                col * stepX,
                row * stepY,
                layout,
                SHAPE_COLORS[index % SHAPE_COLORS.length]
            )
            index++
        }
    }

    return {
        vertices: new Float32Array(out),
        bounds: {
            left: 0,
            top: 0,
            right: widestRow * stepX - layout.columnGap,
            bottom: rows * stepY - layout.rowGap,
        },
    }
}

/*~~~ Scene ~~~*/

class BlockChart implements SceneInstance<ChartValues> {
    private readonly canvas: HTMLCanvasElement
    private readonly gl2: WebGL2RenderingContext
    private readonly program: Program
    private readonly camera = new Camera()

    private mesh: Mesh | null = null
    private bounds = { left: 0, top: 0, right: 1, bottom: 1 }
    private builtKey = ""

    constructor(
        private readonly context: SceneContext
    ) {
        this.gl2 = context.gl2
        this.canvas = context.canvas

        // Every cell has different geometry, so there is nothing to instance -
        // the whole chart bakes into one static mesh and one draw call.
        this.program = new Program(this.gl2, [
            new Shader(this.gl2, this.gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
            new Shader(this.gl2, this.gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])
    }

    update(dt: number, settings: ChartValues): void {
        // Before the early return below, or changing resolution alone would be
        // ignored. Resolution only changes how many pixels the target has, so
        // it is deliberately not part of the rebuild key - the geometry and the
        // camera fit are both resolution independent.
        this.context.setRenderScale(settings.resolution)

        // Any of these three changes the geometry, so rebuild on all of them.
        // The font's `loaded` joins them because the sheet arrives
        // asynchronously - the first build has no glyphs and needs redoing.
        const key = `${settings.mode}/${settings.rows}/${settings.gap}/${DEFAULT_FONT.loaded}`
        if (key === this.builtKey) return

        this.rebuild(makeLayout(settings))
        this.builtKey = key
    }

    render(): void {
        if (!this.mesh) return

        // Refit every frame so a window resize reframes the chart for free.
        const { left, top, right, bottom } = this.bounds
        this.camera.fit(left, top, right, bottom, this.canvas.width, this.canvas.height)

        this.program.use()
        this.gl2.uniformMatrix3fv(
            this.program.uniform("u_Transform"),
            false,
            this.camera.matrix(this.canvas.width, this.canvas.height)
        )

        this.mesh.draw()
    }

    dispose(): void {
        this.mesh?.dispose()
        this.program.dispose()
    }

    private rebuild(layout: ChartLayout) {
        const built = buildChart(layout)

        this.mesh?.dispose()
        this.mesh = new Mesh(this.gl2, built.vertices)
        this.bounds = built.bounds
    }
}

const scene: DevSceneDefinition<ChartValues> = {
    id: "block-chart",
    name: "Block Chart",
    description: "Every block shape with all four turns, plus a second block for mirrorable ones. Lines orders them 0-3 left to right; squares arranges them clockwise from turn 2 so the four join into one symmetric figure.",
    settings: SETTINGS,
    create: (context: SceneContext) => new BlockChart(context),
}

export default scene
