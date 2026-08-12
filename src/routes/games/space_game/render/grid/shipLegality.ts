// Where a block may be placed. No GPU, so the rules are testable and the editor
// and any future validator cannot disagree about them.

import type { Ship } from "../../game/ship"
import { canPlace, type ComponentKind } from "./components"
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
    kind: ComponentKind,
    facing: number,
): Legality {
    if (!canPlace(kind, layer)) {
        return { ok: false, reason: `${kind} cannot go on the ${layer} layer` }
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

    if (kind === "thruster") {
        const step = OFFSETS[((facing % 4) + 4) % 4]!

        for (let distance = 1; distance <= THRUSTER_REACH; distance++) {
            // The first gap within reach means this thruster fires out of the ship
            if (!hull.has(col + step.col * distance, row + step.row * distance)) return { ok: true }
        }

        return { ok: false, reason: `a thruster must be within ${THRUSTER_REACH} blocks of the edge it faces` }
    }

    return { ok: true }
}