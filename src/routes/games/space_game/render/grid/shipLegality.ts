// Where a block may be placed. No GPU, so the rules are testable and the editor
// and any future validator cannot disagree about them.

import type { Ship } from "../../game/ship"
import { canPlace, componentById } from "./components"
import type { ShipLayer } from "./layers"

export interface Legality {
    ok: boolean
    /** Why not, for a tooltip or a warning. Absent when ok. */
    reason?: string
}

/** N, E, S, W - the order `facing` indexes into. */
const OFFSETS = [
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
        // An empty hull has to start somewhere, or nothing could ever be placed
        if (hull.size === 0) return { ok: true }

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
export function bestThrusterFacing(ship: Ship, col: number, row: number, facing: number): number {
    const options = thrusterFacings(ship, col, row)
    const wanted = ((facing % 4) + 4) % 4

    return options.includes(wanted) ? wanted : options[0] ?? wanted
}