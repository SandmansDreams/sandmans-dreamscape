// The sprite editor's canvas: one cell per square, each knowing how it takes colour

import { Color } from "../color"
import type { BlockShape } from "./shapes"
import type { ArtRole } from "./spriteMesh"

/**
 * One square of component art.
 *
 * Deliberately not the ship's `Cell`: that carries kind, level, hit points, mass
 * and facing, none of which a drawing has, and it has nowhere to put a role.
 * Five fields is the whole of what art is.
 */
export interface ArtCell {
    readonly col: number
    readonly row: number
    shape: BlockShape
    turns: number
    mirrored: boolean
    /** How this square takes its colour when a component wears the art. */
    role: ArtRole
    /**
     * Only meaningful on the static role.
     *
     * A main or accent square is recoloured by whatever component is wearing the
     * art, so the value here would be a promise the game does not keep - the
     * editor paints those with the piece's preview colours instead.
     */
    color: Color
}

export interface ArtCellOptions {
    turns?: number
    mirrored?: boolean
    role?: ArtRole
    color?: Color
}

/** Cells keyed by a packed integer rather than a string, as the ship grid does. */
function cellKey(col: number, row: number): number {
    return (col << 8) | row
}

/**
 * A fixed-size drawing surface.
 *
 * Smaller than `Grid` on purpose: no layers, no components, no damage. What it
 * does keep is the revision counter, because the editor caches its mesh against
 * it exactly as the ship scenes do.
 */
export class ArtGrid {
    private readonly cells = new Map<number, ArtCell>()
    private version = 0

    private cached: ArtCell[] = []
    private cachedVersion = -1

    /** Bumped by every mutation, so a mesh can be cached against it. */
    get revision(): number {
        return this.version
    }

    get size(): number {
        return this.cells.size
    }

    set(col: number, row: number, shape: BlockShape, options: ArtCellOptions = {}): ArtCell {
        const cell: ArtCell = {
            col,
            row,
            shape,
            turns: options.turns ?? 0,
            mirrored: options.mirrored ?? false,
            role: options.role ?? "static",
            color: options.color ?? Color.FALLBACK,
        }

        this.cells.set(cellKey(col, row), cell)
        this.version++
        return cell
    }

    /** Inclusive on both corners, so fill(0, 0, 2, 0) writes three cells. */
    fill(
        minCol: number,
        minRow: number,
        maxCol: number,
        maxRow: number,
        shape: BlockShape,
        options: ArtCellOptions = {},
    ): void {
        // Tolerate reversed corners rather than silently writing nothing
        for (let row = Math.min(minRow, maxRow); row <= Math.max(minRow, maxRow); row++) {
            for (let col = Math.min(minCol, maxCol); col <= Math.max(minCol, maxCol); col++) {
                this.set(col, row, shape, options)
            }
        }
    }

    get(col: number, row: number): ArtCell | undefined {
        return this.cells.get(cellKey(col, row))
    }

    has(col: number, row: number): boolean {
        return this.cells.has(cellKey(col, row))
    }

    delete(col: number, row: number): boolean {
        const removed = this.cells.delete(cellKey(col, row))
        if (removed) this.version++
        return removed
    }

    clear(): void {
        if (this.cells.size === 0) return
        this.cells.clear()
        this.version++
    }

    /** Occupied cells as a flat array. Treat as read-only. */
    get list(): readonly ArtCell[] {
        if (this.cachedVersion !== this.version) {
            this.cached = [...this.cells.values()]
            this.cachedVersion = this.version
        }
        return this.cached
    }

    /** Just the cells of one role, which is what the bake works on. */
    ofRole(role: ArtRole): ArtCell[] {
        return this.list.filter((cell) => cell.role === role)
    }
}