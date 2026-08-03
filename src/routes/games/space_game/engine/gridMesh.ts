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
export function buildGridMesh(grid: Grid, cellSize: number): Float32Array {
    const out: number[] = []

    const centre = grid.centre
    const originX = centre.x * cellSize
    const originY = centre.y * cellSize

    for (const cell of grid.list) {
        appendShape(
            out,
            cell.shape,
            cell.turns,
            cell.mirrored,
            cell.col * cellSize - originX,
            cell.row * cellSize - originY,
            cellSize,
            cell.r, cell.g, cell.b
        )
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
