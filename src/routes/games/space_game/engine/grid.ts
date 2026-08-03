import type { BlockShape } from "./shapes"

/**
 * A sparse grid of block cells — the shape of a ship or asteroid.
 *
 * Coordinates are integer cell indices, deliberately unit-agnostic: world size
 * is applied when the mesh is built, so a grid can be reasoned about and tested
 * without a pixel constant anywhere near it.
 *
 * Derived data (the flat cell list, bounds, centre) is cached against a
 * revision counter that every mutation bumps. Mesh building keys off the same
 * counter, so a grid that has not changed never re-tessellates.
 */

export type RGB = readonly [number, number, number]

const DEFAULT_COLOR: RGB = [0.55, 0.60, 0.68]

export interface Cell {
    col: number
    row: number
    shape: BlockShape
    /** Quarter-turns clockwise, normalised to 0-3. */
    turns: number
    mirrored: boolean
    r: number
    g: number
    b: number
}

export interface CellOptions {
    turns?: number
    mirrored?: boolean
    color?: RGB
}

export interface GridBounds {
    minCol: number
    maxCol: number
    minRow: number
    maxRow: number
}

/**
 * Packs a cell coordinate into one integer key.
 *
 * Avoids the string allocation a `"col,row"` key would cost on every lookup —
 * the editor probes this on each pointer move. Valid for |coordinate| < 32768,
 * which is far beyond any hull.
 */
const KEY_OFFSET = 0x8000

function cellKey(col: number, row: number): number {
    return ((col + KEY_OFFSET) << 16) | (row + KEY_OFFSET)
}

export class Grid {
    private cells = new Map<number, Cell>()
    private version = 0

    private listVersion = -1
    private listCache: Cell[] = []

    private boundsVersion = -1
    private boundsCache: GridBounds | null = null

    /** Bumped by every mutation; derived data and meshes key off it. */
    get revision(): number {
        return this.version
    }

    get count(): number {
        return this.cells.size
    }

    // --- Mutation --------------------------------------------------------

    set(col: number, row: number, shape: BlockShape, options: CellOptions = {}) {
        if (shape === "empty") {
            this.delete(col, row)
            return
        }

        const [r, g, b] = options.color ?? DEFAULT_COLOR
        const turns = options.turns ?? 0

        this.cells.set(cellKey(col, row), {
            col, row, shape,
            turns: ((turns % 4) + 4) % 4,
            mirrored: options.mirrored ?? false,
            r, g, b
        })

        this.version++
    }

    /** Fills an inclusive rectangle. Handy for hulls and for tests. */
    fill(
        col0: number, row0: number,
        col1: number, row1: number,
        shape: BlockShape,
        options: CellOptions = {}
    ) {
        for (let row = Math.min(row0, row1); row <= Math.max(row0, row1); row++) {
            for (let col = Math.min(col0, col1); col <= Math.max(col0, col1); col++) {
                this.set(col, row, shape, options)
            }
        }
    }

    delete(col: number, row: number): boolean {
        const removed = this.cells.delete(cellKey(col, row))
        if (removed) this.version++
        return removed
    }

    clear() {
        if (this.cells.size === 0) return
        this.cells.clear()
        this.version++
    }

    // --- Lookup ----------------------------------------------------------

    get(col: number, row: number): Cell | undefined {
        return this.cells.get(cellKey(col, row))
    }

    has(col: number, row: number): boolean {
        return this.cells.has(cellKey(col, row))
    }

    /** True if any of the four orthogonal neighbours is occupied. */
    hasNeighbour(col: number, row: number): boolean {
        return this.has(col - 1, row)
            || this.has(col + 1, row)
            || this.has(col, row - 1)
            || this.has(col, row + 1)
    }

    // --- Derived ---------------------------------------------------------

    /** Occupied cells as a flat array. Treat as read-only. */
    get list(): readonly Cell[] {
        if (this.listVersion !== this.version) {
            this.listCache.length = 0
            for (const cell of this.cells.values()) this.listCache.push(cell)
            this.listVersion = this.version
        }
        return this.listCache
    }

    get bounds(): GridBounds | null {
        if (this.boundsVersion === this.version) return this.boundsCache

        this.boundsVersion = this.version

        if (this.cells.size === 0) {
            this.boundsCache = null
            return null
        }

        let minCol = Infinity, maxCol = -Infinity
        let minRow = Infinity, maxRow = -Infinity

        for (const cell of this.cells.values()) {
            if (cell.col < minCol) minCol = cell.col
            if (cell.col > maxCol) maxCol = cell.col
            if (cell.row < minRow) minRow = cell.row
            if (cell.row > maxRow) maxRow = cell.row
        }

        this.boundsCache = { minCol, maxCol, minRow, maxRow }
        return this.boundsCache
    }

    /**
     * Centre of the occupied area, in cell units.
     *
     * Offset by one because bounds are inclusive cell indices: a single cell at
     * column 0 spans 0 to 1, so its centre is 0.5.
     */
    get centre(): { x: number, y: number } {
        const bounds = this.bounds
        if (!bounds) return { x: 0, y: 0 }

        return {
            x: (bounds.minCol + bounds.maxCol + 1) / 2,
            y: (bounds.minRow + bounds.maxRow + 1) / 2
        }
    }

    /** Width and height of the occupied area, in cells. */
    get extent(): { width: number, height: number } {
        const bounds = this.bounds
        if (!bounds) return { width: 0, height: 0 }

        return {
            width: bounds.maxCol - bounds.minCol + 1,
            height: bounds.maxRow - bounds.minRow + 1
        }
    }
}
