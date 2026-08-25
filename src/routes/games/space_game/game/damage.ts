// How badly a block is hurt, and what that costs it

import { statsFor } from "../render/grid/components"
import { cellKey, type Cell } from "../render/grid/grid"
import type { ShipLayer } from "../render/grid/layers"
import type { Ship } from "./ship"

/**
 * How hurt a part can be before it starts to fail, and before it stops.
 *
 * A band rather than a switch: a part that worked perfectly until it did not
 * would make damage invisible right up to the moment it mattered. Between the
 * two it fades, so a ship degrades in a way you can feel and act on.
 */
export const IMPAIRED_AT = 0.25
export const DISABLED_AT = 0.75

/**
 * How well a part still works, 1 down to 0.
 *
 * Linear between the thresholds. Nothing here is clever, and it should not be:
 * this is the number every system multiplies by, so it wants to be the one a
 * player can predict from a health bar rather than the one that reads best.
 */
export function effectiveness(fraction: number): number {
    if (fraction <= IMPAIRED_AT) return 1
    if (fraction >= DISABLED_AT) return 0

    return 1 - (fraction - IMPAIRED_AT) / (DISABLED_AT - IMPAIRED_AT)
}

/** What a hit did to the block it landed on. */
export type HitResult = "missed" | "hurt" | "destroyed"

/**
 * What a ship has taken, block by block.
 *
 * Kept beside the ship rather than on its cells for one reason: a Cell's
 * `hitPoints` is what the block was built with, and it is what the file records.
 * Subtracting from it would make damage indistinguishable from a block someone
 * deliberately built weaker, and would save a wounded ship as a weak one.
 */
export class ShipDamage {
    private readonly taken = new Map<string, number>()

    /** How many blocks are carrying damage. */
    get count(): number {
        return this.taken.size
    }

    private static key(layer: ShipLayer, col: number, row: number): string {
        return `${layer}|${cellKey(col, row)}`
    }

    /** 0 for untouched, 1 for gone. */
    fractionAt(layer: ShipLayer, cell: Cell): number {
        const hurt = this.taken.get(ShipDamage.key(layer, cell.col, cell.row)) ?? 0
        const most = maxHitPointsOf(cell)

        return most <= 0 ? 1 : Math.min(hurt / most, 1)
    }

    /** How well the block at this cell still does its job. */
    effectivenessAt(layer: ShipLayer, cell: Cell): number {
        return effectiveness(this.fractionAt(layer, cell))
    }

    /**
     * Records a hit, removing the block when it can take no more.
     *
     * The block leaves the grid rather than lingering at zero: a plate with
     * nothing left is a hole, and a hole is something shots pass through and
     * neighbours are exposed by.
     */
    hit(ship: Ship, layer: ShipLayer, col: number, row: number, amount: number): HitResult {
        const grid = ship.layers[layer]
        const cell = grid.get(col, row)
        if (!cell || amount <= 0) return "missed"

        const key = ShipDamage.key(layer, col, row)
        const hurt = (this.taken.get(key) ?? 0) + amount

        if (hurt >= maxHitPointsOf(cell)) {
            this.taken.delete(key)
            grid.delete(col, row)
            return "destroyed"
        }

        this.taken.set(key, hurt)
        return "hurt"
    }

    /** Everything carrying damage, for drawing it. */
    forEach(ship: Ship, visit: (layer: ShipLayer, cell: Cell, fraction: number) => void): void {
        if (this.taken.size === 0) return

        for (const grid of ship.layersOf()) {
            for (const cell of grid.list) {
                const fraction = this.fractionAt(grid.layer, cell)
                if (fraction > 0) visit(grid.layer, cell, fraction)
            }
        }
    }

    clear(): void {
        this.taken.clear()
    }
}

/**
 * What a block had before anything hit it.
 *
 * The cell's own value, which a file may have overridden - a block someone built
 * tougher should take more to break, not the same as a stock one.
 */
export function maxHitPointsOf(cell: Cell): number {
    return cell.hitPoints > 0 ? cell.hitPoints : statsFor(cell.type, cell.level).hitPoints
}
