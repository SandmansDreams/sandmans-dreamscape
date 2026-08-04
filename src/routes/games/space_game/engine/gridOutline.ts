import type { Grid, RGB } from "./grid"
import { appendShape } from "./shapes"

/**
 * Turns a Grid into the outlines of its blocks, as line segments.
 *
 * Same interleaved [x, y, r, g, b] layout and same centring as buildGridMesh,
 * so both feed the same shader — only the primitive differs.
 *
 * The outlines are derived from the triangles rather than declared separately:
 * an edge shared by two triangles is interior and cancels, an edge appearing
 * once is on the boundary. That keeps this from duplicating appendShape and
 * drifting from it — a shape added there gets an outline here for free.
 */

const FLOATS_PER_VERTEX = 5

interface Edge {
    ax: number
    ay: number
    bx: number
    by: number
    count: number
}

/**
 * Canonical key for an undirected edge.
 *
 * Exact float comparison is safe: two triangles sharing an edge produce that
 * vertex through the same expression in pushVertex, so the values are identical
 * bit for bit. Quantising would only hide a problem that does not exist.
 */
function edgeKey(ax: number, ay: number, bx: number, by: number): string {
    return ax < bx || (ax === bx && ay <= by)
        ? `${ax},${ay},${bx},${by}`
        : `${bx},${by},${ax},${ay}`
}

/**
 * Boundary edges of one cell's triangles.
 *
 * Deliberately per cell rather than per grid: neighbouring cells share edges
 * with identical coordinates, and cancelling those too would give the hull's
 * silhouette instead of its blocks.
 */
function boundaryEdges(triangles: number[]): Edge[] {
    const edges = new Map<string, Edge>()

    const consider = (ax: number, ay: number, bx: number, by: number) => {
        const key = edgeKey(ax, ay, bx, by)
        const existing = edges.get(key)

        if (existing) existing.count++
        else edges.set(key, { ax, ay, bx, by, count: 1 })
    }

    const stride = FLOATS_PER_VERTEX * 3

    for (let i = 0; i + stride <= triangles.length; i += stride) {
        const ax = triangles[i],      ay = triangles[i + 1]
        const bx = triangles[i + 5],  by = triangles[i + 6]
        const cx = triangles[i + 10], cy = triangles[i + 11]

        consider(ax, ay, bx, by)
        consider(bx, by, cx, cy)
        consider(cx, cy, ax, ay)
    }

    return [...edges.values()].filter(edge => edge.count === 1)
}

/**
 * @param color one colour for every line. Omit to keep each block's own, which
 *        is useful for reading a palette but makes the wireframe compete with
 *        the solid view rather than reading as a diagram of it.
 */
export function buildGridOutline(grid: Grid, cellSize: number, color?: RGB): Float32Array {
    const out: number[] = []

    const centre = grid.centre
    const originX = centre.x * cellSize
    const originY = centre.y * cellSize

    // Reused across cells so a large hull does not allocate one array per block.
    const triangles: number[] = []

    for (const cell of grid.list) {
        triangles.length = 0

        appendShape(
            triangles,
            cell.shape,
            cell.turns,
            cell.mirrored,
            cell.col * cellSize - originX,
            cell.row * cellSize - originY,
            cellSize,
            cell.r, cell.g, cell.b
        )

        const [r, g, b] = color ?? [cell.r, cell.g, cell.b]

        for (const edge of boundaryEdges(triangles)) {
            out.push(edge.ax, edge.ay, r, g, b)
            out.push(edge.bx, edge.by, r, g, b)
        }
    }

    return new Float32Array(out)
}
