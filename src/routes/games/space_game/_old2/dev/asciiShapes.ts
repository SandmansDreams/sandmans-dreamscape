import { appendShape, DRAWN_SHAPES, MIRRORABLE_SHAPES, type BlockShape } from "../shapes"

/**
 * Point-samples shapes into ASCII so orientations can be read directly.
 *
 * Reading a rotation off a screenshot is slow and error-prone — this exists
 * because a hand-built hull had several cells facing the wrong way and the
 * fastest way to find out was to print the truth table.
 *
 *   npm run shapes            all shapes
 *   npm run shapes arc wedge  just those
 */

const SIZE = 12
const RESOLUTION = 12

function triangles(shape: BlockShape, turns: number, mirrored: boolean): number[][] {
    const out: number[] = []
    appendShape(out, shape, turns, mirrored, 0, 0, SIZE, 1, 1, 1)

    const result: number[][] = []
    for (let i = 0; i < out.length; i += 15) {
        result.push([
            out[i], out[i + 1],
            out[i + 5], out[i + 6],
            out[i + 10], out[i + 11],
        ])
    }
    return result
}

function inside(t: number[], px: number, py: number): boolean {
    const [ax, ay, bx, by, cx, cy] = t

    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)

    // Consistent sign on all three edges means the point is inside.
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

function render(shape: BlockShape, turns: number, mirrored: boolean): string[] {
    const tris = triangles(shape, turns, mirrored)
    const rows: string[] = []

    for (let row = 0; row < RESOLUTION; row++) {
        let line = ""
        for (let col = 0; col < RESOLUTION; col++) {
            const px = ((col + 0.5) / RESOLUTION) * SIZE
            const py = ((row + 0.5) / RESOLUTION) * SIZE
            line += tris.some(t => inside(t, px, py)) ? "█" : "·"
        }
        rows.push(line)
    }

    return rows
}

function printShape(shape: BlockShape) {
    const mirrors = MIRRORABLE_SHAPES.includes(shape) ? [false, true] : [false]

    for (const mirrored of mirrors) {
        const title = mirrored ? `${shape} (mirrored)` : shape
        console.log(`\n=== ${title} ===`)
        console.log([0, 1, 2, 3].map(t => `turns ${t}`.padEnd(RESOLUTION + 2)).join(""))

        const grids = [0, 1, 2, 3].map(t => render(shape, t, mirrored))
        for (let row = 0; row < RESOLUTION; row++) {
            console.log(grids.map(g => g[row] + "  ").join(""))
        }
    }
}

const requested = process.argv.slice(2) as BlockShape[]
const shapes = requested.length > 0 ? requested : [...DRAWN_SHAPES]

for (const shape of shapes) {
    if (!DRAWN_SHAPES.includes(shape)) {
        console.log(`\nunknown shape: ${shape}`)
        continue
    }
    printShape(shape)
}
