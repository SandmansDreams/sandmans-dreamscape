// Cutting a ship into the pieces its hull actually holds together

import { cellKey } from "../render/grid/grid"
import { hullPieces } from "../render/grid/shipLegality"
import { Ship } from "./ship"

/**
 * The hull's connected pieces, heaviest first. One entry means it is whole.
 *
 * Structure is the hull layer and nothing else, because that is already the rule
 * the builder enforces: hull touches hull, and everything else rides on a hull
 * block. So a component belongs to whichever piece holds the plate under it - and
 * one whose plate is gone belongs to no piece at all and is dropped, because it
 * has nothing left to sit on.
 *
 * Coordinates are preserved, so a piece is the same ship with fewer cells. That
 * is what lets a ShipDamage keyed by position follow the cut without re-keying.
 */
export function separateShip(ship: Ship): Ship[] {
    const pieces = hullPieces(ship.layers.hull)
    if (pieces.length <= 1) return [ship]

    const parts = pieces.map((piece) => partOf(ship, piece))
    parts.sort((a, b) => b.mass - a.mass)

    // The heaviest piece is still the ship, so it keeps the id and the rest are
    // named off it - a fragment can be traced back to what it came off
    parts.forEach((part, index) => {
        if (index > 0) part.id = `${ship.id}-${index}`
    })

    return parts
}

/** Every cell whose hull position is in `piece`, copied losslessly. */
function partOf(ship: Ship, piece: Set<number>): Ship {
    const part = new Ship(ship.id, ship.name, ship.creator)

    for (const grid of ship.layersOf()) {
        const into = part.layers[grid.layer]

        for (const cell of grid.list) {
            if (!piece.has(cellKey(cell.col, cell.row))) continue
            // The same spread the builder's undo restores with: every field a
            // file records, including the ones a stock block would have differed on
            into.set(cell.col, cell.row, cell.shape, { ...cell })
        }
    }

    return part
}