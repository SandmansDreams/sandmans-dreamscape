import type { Grid } from "./grid"
import { appendShape } from "./shapes"

/**
 * Turns a Grid into interleaved [x, y, r, g, b] triangles.
 *
 * Vertices come out centred on the grid's own centre, so an entity drawn at
 * world position P has its hull centred on P with no per-frame translation.
 * That offset is baked in once here rather than paid on every draw.
 *
 * No WebGL involved — the result is plain vertex data, which keeps this
 * testable in Node and lets the caller decide how to upload it.
 */
/** Floats a vertex occupies with and without the cell centre. */
export const MESH_STRIDE = 5
export const LIT_MESH_STRIDE = 7

/**
 * @param withCellCentre appends the centre of the cell each vertex belongs to,
 *        giving [x, y, r, g, b, cx, cy]. Shading that varies per cell rather
 *        than per pixel needs it: every vertex of a block reports the same
 *        point, so the whole block resolves to one illumination value.
 */
export function buildGridMesh(
    grid: Grid,
    cellSize: number,
    withCellCentre = false
): Float32Array {
    const out: number[] = []

    const centre = grid.centre
    const originX = centre.x * cellSize
    const originY = centre.y * cellSize

    // Reused across cells: appendShape only knows how to write five floats per
    // vertex, so the centre is stitched on afterwards from this scratch buffer.
    const vertices: number[] = []

    for (const cell of grid.list) {
        const x = cell.col * cellSize - originX
        const y = cell.row * cellSize - originY

        if (!withCellCentre) {
            appendShape(out, cell.shape, cell.turns, cell.mirrored, x, y, cellSize, cell.r, cell.g, cell.b)
            continue
        }

        vertices.length = 0
        appendShape(vertices, cell.shape, cell.turns, cell.mirrored, x, y, cellSize, cell.r, cell.g, cell.b)

        const cellX = x + cellSize / 2
        const cellY = y + cellSize / 2

        for (let i = 0; i < vertices.length; i += MESH_STRIDE) {
            out.push(
                vertices[i], vertices[i + 1],
                vertices[i + 2], vertices[i + 3], vertices[i + 4],
                cellX, cellY
            )
        }
    }

    return new Float32Array(out)
}

/**
 * Caches a grid's mesh, rebuilding only when the grid actually changes.
 *
 * Hulls are edited rarely and drawn constantly, so the revision check is what
 * keeps tessellation off the frame budget entirely.
 */
export class GridMeshCache {
    private mesh: Float32Array = new Float32Array(0)
    private builtRevision = -1
    private builtCellSize = 0

    constructor(private readonly grid: Grid, private cellSize: number) {}

    get vertices(): Float32Array {
        if (this.builtRevision !== this.grid.revision || this.builtCellSize !== this.cellSize) {
            this.mesh = buildGridMesh(this.grid, this.cellSize)
            this.builtRevision = this.grid.revision
            this.builtCellSize = this.cellSize
        }
        return this.mesh
    }

    get vertexCount(): number {
        return this.vertices.length / 5
    }

    /** True if the next `vertices` read will rebuild. */
    get stale(): boolean {
        return this.builtRevision !== this.grid.revision || this.builtCellSize !== this.cellSize
    }

    setCellSize(size: number) {
        this.cellSize = size
    }
}
