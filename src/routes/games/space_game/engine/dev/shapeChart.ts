import { appendShape, DRAWN_SHAPES, MIRRORABLE_SHAPES, type BlockShape } from "../shapes"

/**
 * A visual proof sheet for the tessellator: one row per shape, four columns of
 * quarter-turns, plus four more for the mirrored form where a shape has one.
 *
 * Rows come from DRAWN_SHAPES, so adding a shape to BLOCK_SHAPES is all it
 * takes to get a row here. Backdrops are only drawn where a shape will appear,
 * so a row stopping at four columns is itself the signal that mirroring adds
 * nothing for that shape.
 *
 * Backdrops are emitted directly rather than through appendShape, so the grid
 * frames itself even for a shape that is declared but not yet implemented.
 */

const TURN_COUNT = 4

export interface ShapeChart {
    vertices: Float32Array
    /** Extent in world units, for framing the camera. */
    width: number
    height: number
    /** Row order, top to bottom. */
    shapes: readonly BlockShape[]
    /** Widest row, in cells. */
    columns: number
}

const BACKDROP: [number, number, number] = [0.11, 0.11, 0.15]

/**
 * One colour per row, cycled if there are ever more rows than entries.
 *
 * Extend it rather than letting two rows share — telling rows apart is the
 * whole point of the chart.
 */
const ROW_COLORS: [number, number, number][] = [
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

function pushBackdrop(
    out: number[],
    left: number, top: number, right: number, bottom: number,
    r: number, g: number, b: number
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

export function buildShapeChart(cell: number = 40, gap: number = 8): ShapeChart {
    const out: number[] = []
    const step = cell + gap
    const shapes = DRAWN_SHAPES

    // Extra breathing room between the plain turns and the mirrored ones, so
    // the two groups read as separate at a glance.
    const groupGap = gap * 2

    const anyMirrored = shapes.some(shape => MIRRORABLE_SHAPES.includes(shape))
    const columns = anyMirrored ? TURN_COUNT * 2 : TURN_COUNT

    /** Left edge of a cell, given its turn and whether it is in the mirrored group. */
    const columnX = (turn: number, mirrored: boolean) =>
        (mirrored ? TURN_COUNT + turn : turn) * step + (mirrored ? groupGap : 0)

    /** Mirrored columns only exist for shapes that gain something from them. */
    const groupsFor = (shape: BlockShape): boolean[] =>
        MIRRORABLE_SHAPES.includes(shape) ? [false, true] : [false]

    for (let row = 0; row < shapes.length; row++) {
        for (const mirrored of groupsFor(shapes[row])) {
            for (let turn = 0; turn < TURN_COUNT; turn++) {
                const x = columnX(turn, mirrored)
                const y = row * step
                pushBackdrop(out, x, y, x + cell, y + cell, ...BACKDROP)
            }
        }
    }

    for (let row = 0; row < shapes.length; row++) {
        const [r, g, b] = ROW_COLORS[row % ROW_COLORS.length]
        const shape = shapes[row]

        for (const mirrored of groupsFor(shape)) {
            for (let turn = 0; turn < TURN_COUNT; turn++) {
                appendShape(out, shape, turn, mirrored, columnX(turn, mirrored), row * step, cell, r, g, b)
            }
        }
    }

    return {
        vertices: new Float32Array(out),
        width: columns * step - gap + (anyMirrored ? groupGap : 0),
        height: Math.max(1, shapes.length) * step - gap,
        shapes,
        columns
    }
}
