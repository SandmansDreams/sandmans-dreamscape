// Turns a Grid into triangles, and keeps the resulting GPU mesh up to date

import type { GPU } from "../webgpu/gpu"
import type { Grid } from "./grid"
import { Mesh, MeshBuilder } from "../mesh"
import { appendShape } from "./shapes"
import type { Vec2 } from "../camera"

/**
 * Appends every cell of `grid` to `builder`, in world units.
 *
 * @param origin the point, in cell units, that lands at (0, 0). Pass the same
 *        origin for every layer of a ship or they drift apart, since each grid's
 *        own center depends only on the cells that happen to be on that layer.
 *        Defaults to this grid's own center for a standalone grid.
 */
export function appendGridMesh(
    builder: MeshBuilder,
    grid: Grid,
    cellSize: number,
    origin: Vec2 = grid.center,
): void {
    const originX = origin.x * cellSize
    const originY = origin.y * cellSize

    for (const cell of grid.list) {
        appendShape(
            builder,
            cell.shape,
            cell.turns,
            cell.mirrored,
            cell.col * cellSize - originX,
            cell.row * cellSize - originY,
            cellSize,
            cell.color,
        )
    }
}

/**
 * Caches a grid's GPU mesh, rebuilding only when the grid's geometry actually
 * changes.
 *
 * Hulls are edited rarely and drawn constantly, so the revision check is what
 * keeps tessellation off the frame budget entirely. It watches geometryRevision
 * rather than revision, so taking damage does not re-tessellate a ship.
 */
export class GridMeshCache {
    private readonly gpu: GPU
    private readonly grid: Grid
    private readonly label: string

    private cellSize: number
    private mesh: Mesh | null = null
    private builtRevision = -1
    private builtCellSize = 0

    constructor(gpu: GPU, grid: Grid, cellSize: number, label = "hull") {
        this.gpu = gpu
        this.grid = grid
        this.cellSize = cellSize
        this.label = label
    }

    /** True if the next `current` read will rebuild. */
    get stale(): boolean {
        return this.builtRevision !== this.grid.geometryRevision || this.builtCellSize !== this.cellSize
    }

    /** The up-to-date mesh, or null when the grid is empty. */
    get current(): Mesh | null {
        if (!this.stale) return this.mesh

        const builder = new MeshBuilder()
        appendGridMesh(builder, this.grid, this.cellSize)

        // A GPU buffer cannot be resized, so a changed hull means a new Mesh
        this.mesh?.destroy()
        this.mesh = builder.vertexCount === 0 ? null : builder.build(this.gpu, this.label)

        this.builtRevision = this.grid.geometryRevision
        this.builtCellSize = this.cellSize
        return this.mesh
    }

    setCellSize(size: number): void {
        this.cellSize = size
    }

    destroy(): void {
        this.mesh?.destroy()
        this.mesh = null
    }
}