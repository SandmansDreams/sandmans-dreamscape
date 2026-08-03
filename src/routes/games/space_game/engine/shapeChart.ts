import { appendShape, type BlockShape } from "./shapes"

/**
 * A visual proof sheet for the tessellator: every shape across every rotation,
 * laid out in a grid with a dark backdrop behind each cell.
 *
 * The backdrops are emitted directly rather than through appendShape, so the
 * chart shows its own frame even while appendShape is unimplemented — the
 * shapes then fill in as you build them.
 */

const CHART_SHAPES: BlockShape[] = ["full", "wedge", "arc"]

/** One colour per row, so a misrouted shape is obvious at a glance. */
const ROW_COLORS: [number, number, number][] = [
    [0.35, 0.65, 1.00],   // full   — blue
    [1.00, 0.55, 0.25],   // wedge  — orange
    [0.45, 0.85, 0.45],   // arc    — green
]

const BACKDROP: [number, number, number] = [0.11, 0.11, 0.15]

function pushQuad(
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

export interface ShapeChart {
    vertices: Float32Array
    /** Extent of the chart in world units, for framing the camera on it. */
    width: number
    height: number
}

export function buildShapeChart(cell: number = 40, gap: number = 8): ShapeChart {
    const out: number[] = []
    const step = cell + gap

    // Backdrops first. Nothing here depends on appendShape, so the grid is
    // visible from the first run and each shape appears as it is implemented.
    for (let row = 0; row < CHART_SHAPES.length; row++) {
        for (let turn = 0; turn < 4; turn++) {
            const x = turn * step
            const y = row * step
            pushQuad(out, x, y, x + cell, y + cell, ...BACKDROP)
        }
    }

    for (let row = 0; row < CHART_SHAPES.length; row++) {
        const [r, g, b] = ROW_COLORS[row % ROW_COLORS.length]

        for (let turn = 0; turn < 4; turn++) {
            appendShape(out, CHART_SHAPES[row], turn, turn * step, row * step, cell, r, g, b)
        }
    }

    return {
        vertices: new Float32Array(out),
        width: 4 * step - gap,
        height: CHART_SHAPES.length * step - gap
    }
}
