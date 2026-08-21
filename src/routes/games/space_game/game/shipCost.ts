// What a ship costs to build

import { COMPONENT_KINDS, kindOf, statsFor, type ComponentKind } from "../render/grid/components"
import type { Cell } from "../render/grid/grid"
import type { Ship } from "./ship"

/** A number per category, for a breakdown that has to cover every drawer. */
export type PerKind = Record<ComponentKind, number>

/** Zeroed, derived from the categories so a new one cannot be forgotten here. */
function perKind(): PerKind {
    return Object.fromEntries(COMPONENT_KINDS.map((kind) => [kind, 0])) as PerKind
}

/**
 * Every cell that has a price - which is every cell not on the cosmetic layer.
 *
 * Cosmetics are free, the same way their mass is. The rule lives here rather than
 * being trusted to each caller, which is exactly how Grid.set handles mass.
 */
function* pricedCells(ship: Ship): Generator<Cell> {
    for (const grid of ship.layersOf()) {
        if (grid.layer === "cosmetic") continue
        yield* grid.list
    }
}

/** What one cell adds to the bill. No instanceof: cost is on the base stats. */
function costOf(cell: Cell): number {
    return statsFor(cell.type, cell.level).cost
}

/**
 * What a ship costs to build.
 *
 * Derived on every ask rather than stored per cell: a price is not something a
 * cell can override, so there is nothing to serialise and nothing to migrate.
 * Cheap enough that the builder recomputes it on each edit.
 */
export function shipCost(ship: Ship): number {
    let total = 0
    for (const cell of pricedCells(ship)) total += costOf(cell)
    return total
}

/** The same total split by category, for the download dialog's summary. */
export function costByKind(ship: Ship): PerKind {
    const costs = perKind()
    for (const cell of pricedCells(ship)) costs[kindOf(cell.type)] += costOf(cell)
    return costs
}