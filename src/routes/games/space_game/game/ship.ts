// A ship: one Grid per layer, drawn bottom to top

import type { Vec2 } from "../render/camera"
import { Grid, type GridBounds } from "../render/grid/grid"
import { SHIP_LAYERS, type ShipLayer } from "../render/grid/layers"

export class Ship {
    id: string
    name: string
    creator: string
    readonly layers: Record<ShipLayer, Grid>

    /**
     * `creator` defaults to the same string readShip falls back to, so a ship
     * built in code and one read from a file without the field agree rather than
     * one of them being empty.
     */
    constructor(id: string, name: string, creator = "Unknown") {
        this.id = id
        this.name = name
        this.creator = creator

        // Built here rather than in a second step, so a Ship is never half-made
        const layers = {} as Record<ShipLayer, Grid>
        for (const layer of SHIP_LAYERS) layers[layer] = new Grid(layer)
        this.layers = layers
    }

    /** Every grid, in render order. */
    layersOf(): Grid[] {
        return SHIP_LAYERS.map((layer) => this.layers[layer])
    }

    get mass(): number {
        let total = 0
        for (const grid of this.layersOf()) total += grid.mass
        return total
    }

    /**
     * Mass-weighted centroid across every layer, in cell units - the point the
     * ship rotates about.
     *
     * Cosmetics weigh nothing, so decorating a ship can never shift its handling.
     * That is the design rule made structural rather than remembered.
     */
    get centerOfMass(): Vec2 {
        let total = 0
        let x = 0
        let y = 0

        for (const grid of this.layersOf()) {
            for (const cell of grid.list) {
                if (cell.mass <= 0) continue
                // Cell centers, not corners: a cell at column 0 spans 0 to 1
                total += cell.mass
                x += (cell.col + 0.5) * cell.mass
                y += (cell.row + 0.5) * cell.mass
            }
        }

        return total === 0 ? { x: 0, y: 0 } : { x: x / total, y: y / total }
    }

    /**
     * Combined geometry revision, for caching a whole ship's mesh.
     *
     * A sum rather than a max: both are monotonic, but a sum also changes when
     * one layer advances while another rolls back, which a max would miss.
     */
    get geometryRevision(): number {
        let total = 0
        for (const grid of this.layersOf()) total += grid.geometryRevision
        return total
    }

    /** Union of every layer's bounds, in cell units. Null when the ship is empty. */
    get bounds(): GridBounds | null {
        let result: GridBounds | null = null

        for (const grid of this.layersOf()) {
            const bounds = grid.bounds
            if (!bounds) continue

            if (!result) {
                result = { ...bounds }
                continue
            }
            result.minCol = Math.min(result.minCol, bounds.minCol)
            result.minRow = Math.min(result.minRow, bounds.minRow)
            result.maxCol = Math.max(result.maxCol, bounds.maxCol)
            result.maxRow = Math.max(result.maxRow, bounds.maxRow)
        }

        return result
    }

    /** Center of the bounding box, in cell units. Not the same point as centerOfMass. */
    get center(): Vec2 {
        const bounds = this.bounds
        if (!bounds) return { x: 0, y: 0 }

        // Offset by one because bounds are inclusive cell indices
        return {
            x: (bounds.minCol + bounds.maxCol + 1) / 2,
            y: (bounds.minRow + bounds.maxRow + 1) / 2,
        }
    }
}