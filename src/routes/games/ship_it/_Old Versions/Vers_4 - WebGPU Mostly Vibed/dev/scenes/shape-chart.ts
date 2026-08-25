import { Camera } from "../../render/camera"
import { DEFAULT_FONT } from "../../render/font"
import type { Frame } from "../../render/frame"
import { Mesh, MeshBuilder } from "../../render/mesh"
import { Color } from "../../render/color"
import type { SceneContext, SceneInstance } from "../../render/scene"
import { appendShape, MIRRORABLE_SHAPES, turnCount, type BlockShape } from "../../render/grid/shapes"
import { DRAWN_SHAPES, shapeColor } from "../../render/grid/palette"
import { appendBlock, type BlockLike } from "../../render/grid/blockDraw"
import { ART_COMPONENTS, type Component } from "../../render/grid/components"
import type { SettingsSchema, ValuesOf } from "../../_Old Versions/Vers_4 - WebGPU Mostly Vibed/settings/settings"
import type { DevSceneDefinition } from "../DevScene"

const SETTINGS = {
    view:    { type: "selection", label: "View", default: "shapes",
               options: ["shapes", "sprites"], display: "segmented" },
    mode:    { type: "selection", label: "Turns", default: "squares",
               options: ["squares", "lines"], display: "segmented" },
    gap:     { type: "range", label: "Gap", default: 5, min: 0, max: 5, step: 0.05 },
    palette: { type: "checkbox", label: "Per-shape color", default: false },
    color:   { type: "color", label: "Color", default: "#7fd4ff" },
    accent:  { type: "color", label: "Accent", default: "#ffb347" },
} as const satisfies SettingsSchema

type ChartValues = ValuesOf<typeof SETTINGS>
// Inferred from the schema's options - adding a layout there is a compile error
// in arrangementFor until it handles the new mode
type ChartMode = ChartValues["mode"]

const BACKDROP_COLOR = Color.rgb(0.10, 0.10, 0.10)
const LABEL_COLOR = Color.rgb(0.60, 0.60, 0.60)

/** How far a finished view reaches, so the camera can frame it. */
interface ChartSize {
    width: number
    height: number
}

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
 * A block that exists only to be drawn: one component, at one level.
 *
 * Nothing here is on a ship, so there is no cell to borrow - and inventing a
 * column and a row just to satisfy Cell is what BlockLike exists to avoid. The
 * shape fields are ignored, since a component never draws as its shape.
 *
 * Facing is fixed north: this sheet is about how a piece changes with its level,
 * and four headings of each would bury that under rotations.
 */
function spriteBlock(
    component: Component,
    level: number,
    color: Color,
    accentColor: Color,
): BlockLike {
    return {
        shape: "full",
        turns: 0,
        mirrored: false,
        type: component.id,
        facing: 0,
        level,
        color,
        accentColor,
    }
}

/** The most levels any one component has, which is how many columns the sheet needs. */
function maxLevelColumns(): number {
    return ART_COMPONENTS.reduce((most, component) => Math.max(most, component.levels.length), 0)
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

    private mesh: Mesh | null = null
    private bounds = { left: 0, top: 0, right: 1, bottom: 1 }
    private builtKey = ""

    constructor(context: SceneContext) {
        this.context = context
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

        const { camera, mesh: pipeline } = this.context.renderer
        camera.upload(this.camera, gpu.width, gpu.height)

        frame.setPipeline(pipeline).setBindGroup(0, camera.group)
        this.mesh.draw(frame)
    }

    dispose(): void {
        this.mesh?.destroy()
    }

    private rebuild(settings: ChartValues): void {
        const builder = new MeshBuilder()
        const layout = makeLayout(settings)

        const size = settings.view === "sprites"
            ? this.appendSpriteRows(builder, layout, settings)
            : this.appendShapeRows(builder, layout, settings)

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
            right: Math.max(size.width, 1),
            bottom: Math.max(size.height, 1),
        }
    }

    /** One row per shape, at the turns that shape actually has. */
    private appendShapeRows(
        builder: MeshBuilder,
        layout: ChartLayout,
        settings: ChartValues,
    ): ChartSize {
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

        return {
            width: mirroredX + blockW,
            // Trailing rowGap is not part of the chart
            height: firstRowY + DRAWN_SHAPES.length * rowStep - layout.rowGap,
        }
    }

    /**
     * One row per component, its levels across.
     *
     * Levels rather than facings: a component's art is authored per level, so
     * this is the axis that actually shows something new - and it is where a
     * level quietly falling back to the type's one piece becomes visible.
     *
     * The turn arrangement has no say here. Every row is a single line of cells,
     * because a level is a step along one axis and stacking it into a square
     * would invent a second one.
     */
    private appendSpriteRows(
        builder: MeshBuilder,
        layout: ChartLayout,
        settings: ChartValues,
    ): ChartSize {
        const labelWidth = labelColumnWidth(layout, ART_COMPONENTS.map((c) => c.id))
        const columns = maxLevelColumns()
        const step = layout.cell + layout.gap
        const rowStep = layout.cell + layout.rowGap

        const main = Color.from(settings.color)
        const accent = Color.from(settings.accent)

        // Header: which level each column holds, in place of the turn key
        for (let column = 0; column < columns; column++) {
            const text = `L${column + 1}`
            const pixel = layout.headerPixel

            DEFAULT_FONT.appendText(
                builder, text,
                labelWidth + column * step
                    + (layout.cell - DEFAULT_FONT.measureText(text, pixel)) / 2,
                (layout.cell - textHeight(pixel)) / 2,
                pixel, LABEL_COLOR,
            )
        }

        ART_COMPONENTS.forEach((component, index) => {
            const y = rowStep + index * rowStep

            DEFAULT_FONT.appendText(
                builder, component.id, 0,
                y + (layout.cell - textHeight(layout.fontPixel)) / 2,
                layout.fontPixel, LABEL_COLOR,
            )

            for (let column = 0; column < columns; column++) {
                // Past this component's last level the cell is left empty rather
                // than repeating the highest one: a blank column says "there is no
                // L4 here", and a copy would say the opposite
                if (column >= component.levels.length) continue

                const x = labelWidth + column * step

                // Backdrop first: there is no depth test, so draw order is the
                // only thing putting the sprite on top of it
                builder.quad(x, y, layout.cell, layout.cell, BACKDROP_COLOR)
                appendBlock(
                    builder,
                    spriteBlock(component, column + 1, main, accent),
                    x, y, layout.cell,
                )
            }
        })

        return {
            width: labelWidth + columns * layout.cell + (columns - 1) * layout.gap,
            height: rowStep + ART_COMPONENTS.length * rowStep - layout.rowGap,
        }
    }
}

const scene: DevSceneDefinition<ChartValues> = {
    id: "shape-chart",
    name: "Shape Chart",
    description:
        "Shapes: every block shape at the turns it actually has - a full block gets one " +
        "cell, a hexagon two, most four - with a second block for the three shapes where " +
        "mirroring is not just another rotation, and the key at the top says which cell " +
        "is which turn. Sprites: every component's art, one row each, with its levels " +
        "across - painted in the main and accent colours picked below, so a design can be " +
        "checked in more than the one palette it was drawn in.",
    settings: SETTINGS,
    create: (context) => new ShapeChart(context),
}

export default scene
