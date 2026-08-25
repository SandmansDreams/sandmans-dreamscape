// Where a block may be placed. No GPU, so the rules are testable and the editor
// and any future validator cannot disagree about them.

import type { Ship } from "../../game/ship"
import { canPlace, componentById } from "./components"
import { cellKey, type Cell, type Grid } from "./grid"
import { SHIP_LAYERS, type ShipLayer } from "./layers"

export interface Legality {
    ok: boolean
    /** Why not, for a tooltip or a warning. Absent when ok. */
    reason?: string
}

/**
 * How far from the origin the first hull block may go, in cells.
 *
 * Matches the margin the editor draws its marks with, and has to: the marks are
 * a promise about where a click will work. Two either way, so the opening move is
 * a 5x5 box rather than the whole infinite plane.
 */
export const START_REACH = 2

/** True when this cell is inside the box the first block may start in. */
export function inStartArea(col: number, row: number): boolean {
    return Math.abs(col) <= START_REACH && Math.abs(row) <= START_REACH
}

/** N, E, S, W - the order `facing` indexes into. */
export const OFFSETS = [
    { col: 0, row: -1 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: -1, row: 0 },
] as const

/**
 * How far a thruster may sit from the hull edge it points at.
 *
 * The design doc says "1-2 blocks in from the edge", which this expresses as a
 * walk outward rather than as a definition of "edge" - a concave hull has no
 * single answer to what its edge is, but "how far until the hull stops" always
 * does.
 */
const THRUSTER_REACH = 2

export function canPlaceAt(
    ship: Ship,
    layer: ShipLayer,
    col: number,
    row: number,
    type: string,
): Legality {
    const component = componentById(type)

    if (!canPlace(type, layer)) {
        return { ok: false, reason: `${component.name} cannot go on the ${layer} layer` }
    }

    const hull = ship.layers.hull

    if (layer === "hull") {
        // An empty hull has to start somewhere, but not anywhere: the editor draws
        // a small box of marks around the origin, and a click outside it that
        // silently worked would make those marks a lie
        if (hull.size === 0) {
            return inStartArea(col, row)
                ? { ok: true }
                : { ok: false, reason: "the first block goes in the middle" }
        }

        // Repainting a block that is already there is always allowed - it changes no connectivity, and refusing it would strand a lone starter block
        if (hull.has(col, row)) return { ok: true }

        if (!hull.hasNeighbor(col, row)) {
            return { ok: false, reason: "must touch an existing hull block" }
        }
    } else if (!hull.has(col, row)) {
        // Everything else rides on the hull rather than floating beside it
        return { ok: false, reason: "must sit on a hull block" }
    }

    // By category, not by type: every thruster answers to the same edge rule
    if (component.kind === "thruster" && thrusterFacings(ship, col, row).length === 0) {
        return { ok: false, reason: `a thruster must be within ${THRUSTER_REACH} blocks of an edge` }
    }

    return { ok: true }
}

/**
 * Every direction a thruster here could fire, in N/E/S/W order.
 *
 * All four are tried rather than only the one the brush happens to point at: a
 * cell two in from the stern can fire aft whichever way the brush was left, and
 * refusing it because the brush pointed north reads as an arbitrary rule. The
 * caller places with one of these, and an empty list is what makes the cell
 * illegal for a thruster at all.
 */
export function thrusterFacings(ship: Ship, col: number, row: number): number[] {
    const hull = ship.layers.hull
    const found: number[] = []

    for (const [facing, step] of OFFSETS.entries()) {
        for (let distance = 1; distance <= THRUSTER_REACH; distance++) {
            // The first gap within reach means a thruster fires out of the ship this way
            if (!hull.has(col + step.col * distance, row + step.row * distance)) {
                found.push(facing)
                break
            }
        }
    }

    return found
}

/**
 * The facing to actually place with: the brush's, when it works from here.
 *
 * Falling back to the first direction that does keeps a thruster from being
 * refused for pointing the wrong way - it turns to face an edge instead.
 */
/**
 * The next facing after `facing` among the ones offered, wrapping.
 *
 * For stepping a brush through the directions a cell can actually take. Stepping
 * by one instead looks broken: `bestThrusterFacing` snaps an illegal facing to
 * the same fallback every time, so on a cell with two legal directions half the
 * presses appear to do nothing.
 *
 * Returns `facing` unchanged when nothing is on offer, so a caller with no legal
 * placement is left holding what it had rather than a number picked from thin air.
 */
export function nextFacing(options: readonly number[], facing: number): number {
    if (options.length === 0) return facing

    // Strictly after, so a facing already in the list advances rather than sticking
    return options.find((option) => option > facing) ?? options[0]!
}

export function bestThrusterFacing(ship: Ship, col: number, row: number, facing: number): number {
    const options = thrusterFacings(ship, col, row)
    const wanted = ((facing % 4) + 4) % 4

    return options.includes(wanted) ? wanted : options[0] ?? wanted
}

/**
 * Whether a block can be taken off the ship.
 *
 * Only the hull has anything to protect: it carries everything else, and it is
 * the only layer whose blocks have to stay in one piece.
 */
export function canEraseAt(ship: Ship, layer: ShipLayer, col: number, row: number): Legality {
    // Erasing empty space is a no-op, not an offence - a drag crosses plenty of it
    if (!ship.layers[layer].has(col, row)) return { ok: true }

    if (layer !== "hull") return { ok: true }

    for (const above of SHIP_LAYERS) {
        if (above === "hull") continue
        if (ship.layers[above].has(col, row)) {
            return { ok: false, reason: `a ${above} block sits on this one` }
        }
    }

    if (splitsHull(ship.layers.hull, col, row)) {
        return { ok: false, reason: "A ship must be one whole object with no floating pieces" }
    }

    return { ok: true }
}

/**
 * The hull's 4-connected pieces, as sets of cell keys, optionally as it would be
 * with one cell taken out.
 *
 * The builder asks this to refuse a cut; the runtime asks it to perform one. Both
 * want the same walk, and two copies of it is how a shot ends up splitting a ship
 * along a seam the builder would have said was whole.
 *
 * Keyed by `cellKey` rather than a string: this runs per erase attempt in the
 * builder, and packing into an integer is what the Grid already does.
 */
export function hullPieces(hull: Grid, skip?: { col: number; row: number }): Set<number>[] {
    const remaining = new Map<number, Cell>()
    for (const cell of hull.list) {
        if (skip && cell.col === skip.col && cell.row === skip.row) continue
        remaining.set(cellKey(cell.col, cell.row), cell)
    }

    const pieces: Set<number>[] = []

    while (remaining.size > 0) {
        // Deleted on the way into the queue rather than tracked in a second
        // `seen` set - what is left to reach and what has been reached are the
        // same question asked from opposite ends
        const [startKey, start] = remaining.entries().next().value!
        const piece = new Set<number>([startKey])
        remaining.delete(startKey)

        const queue: Cell[] = [start]
        while (queue.length > 0) {
            const at = queue.pop()!

            for (const step of OFFSETS) {
                const key = cellKey(at.col + step.col, at.row + step.row)
                const next = remaining.get(key)
                if (!next) continue

                remaining.delete(key)
                piece.add(key)
                queue.push(next)
            }
        }

        pieces.push(piece)
    }

    return pieces
}

/** True when removing one cell would leave hull the rest cannot reach. */
function splitsHull(hull: Grid, col: number, row: number): boolean {
    return hullPieces(hull, { col, row }).length > 1
}

/** Whether a whole layer can be emptied. */
export function canClearLayer(ship: Ship, layer: ShipLayer): Legality {
    if (layer !== "hull") return { ok: true }

    const riding = SHIP_LAYERS
        .filter((other) => other !== "hull")
        .reduce((total, other) => total + ship.layers[other].size, 0)

    if (riding === 0) return { ok: true }

    return {
        ok: false,
        reason: `${riding} block${riding === 1 ? "" : "s"} still ride on the hull`,
    }
}