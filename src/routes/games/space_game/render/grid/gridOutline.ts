// Block outlines as line segments, derived from the same triangles as the solid mesh

import type { Vec2 } from "../camera"
import type { Color } from "../color"
import { MeshBuilder, FLOATS_PER_VERTEX } from "../mesh"
import type { Cell, Grid } from "./grid"
import { appendShape, type BlockShape } from "./shapes"

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
 * vertex through the same expression in pushVertex, and the quarter-turns there
 * are exact integer swaps with no trig, so the values match bit for bit.
 * Quantising would only hide a problem that does not exist.
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
 * silhouette instead of a diagram of its blocks.
 */
function boundaryEdges(triangles: Float32Array): Edge[] {
    const edges = new Map<string, Edge>()

    const consider = (ax: number, ay: number, bx: number, by: number) => {
        const key = edgeKey(ax, ay, bx, by)
        const existing = edges.get(key)

        if (existing) existing.count++
        else edges.set(key, { ax, ay, bx, by, count: 1 })
    }

    const stride = FLOATS_PER_VERTEX * 3

    for (let i = 0; i + stride <= triangles.length; i += stride) {
        const ax = triangles[i]!, ay = triangles[i + 1]!
        const bx = triangles[i + 5]!, by = triangles[i + 6]!
        const cx = triangles[i + 10]!, cy = triangles[i + 11]!

        consider(ax, ay, bx, by)
        consider(bx, by, cx, cy)
        consider(cx, cy, ax, ay)
    }

    // An edge seen twice is interior to the block and cancels
    return [...edges.values()].filter((edge) => edge.count === 1)
}

/**
 * Appends a grid's block outlines as [x, y, r, g, b] line-list vertices.
 *
 * Writes into a plain array rather than a MeshBuilder because these are pairs,
 * not triangles - MeshBuilder asserts whole triangles. The vertex layout is
 * identical, so the same shader and VERTEX_LAYOUT serve both; only the
 * pipeline's topology differs.
 *
 * @param color one color for every line. Omit to keep each block's own, which
 *        reads a palette well but makes the wireframe compete with the solid
 *        view rather than reading as a diagram of it.
 */
/** What a cell draws as. Enough for an outline; no color, since that is separate. */
export interface OutlineShape {
    shape: BlockShape
    turns: number
    mirrored: boolean
}

const OWN_SHAPE = (cell: Cell): OutlineShape =>
    ({ shape: cell.shape, turns: cell.turns, mirrored: cell.mirrored })

export function appendGridOutline(
    out: number[],
    grid: Grid,
    cellSize: number,
    origin: Vec2,
    color?: Color,
    /**
     * What each cell draws as. Defaults to the cell's own shape.
     *
     * A caller that substitutes placeholder art in its solid mesh must pass the
     * same substitution here, or the outline traces a different figure from the
     * one on screen.
     */
    resolve: (cell: Cell) => OutlineShape = OWN_SHAPE,
): void {
    const originX = origin.x * cellSize
    const originY = origin.y * cellSize

    // One builder reused across cells rather than one per block
    const scratch = new MeshBuilder()

    for (const cell of grid.list) {
        const { shape, turns, mirrored } = resolve(cell)

        scratch.clear()
        appendShape(
            scratch,
            shape,
            turns,
            mirrored,
            cell.col * cellSize - originX,
            cell.row * cellSize - originY,
            cellSize,
            cell.color,
        )

        appendTriangleOutline(out, scratch.toArray(), color ?? cell.color)
    }
}

/**
 * Outlines any triangle list as line segments.
 *
 * Exposed separately so a caller with its own geometry - glyph runs, say - can
 * be outlined the same way blocks are, instead of needing a second algorithm.
 */
export function appendTriangleOutline(out: number[], triangles: Float32Array, color: Color): void {
    const { r, g, b } = color

    for (const edge of boundaryEdges(triangles)) {
        out.push(edge.ax, edge.ay, r, g, b)
        out.push(edge.bx, edge.by, r, g, b)
    }
}