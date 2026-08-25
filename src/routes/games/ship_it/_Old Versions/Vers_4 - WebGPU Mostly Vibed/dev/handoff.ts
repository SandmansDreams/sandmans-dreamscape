// A ship passed from one scene to another, and the way back

import type { Ship } from "../game/ship"
import { shipFromText, shipToText } from "../game/shipJson"

/** A ship in flight between two scenes, with the scene that sent it. */
export interface Handoff {
    /** The ship, as the same text a file holds. */
    text: string
    /** The scene id to return to. */
    from: string
}

/**
 * The one ship waiting to be picked up, if any.
 *
 * Module state rather than a channel through the page, because the two ends are
 * a scene being torn down and a scene being built - there is no moment when both
 * exist to pass anything between them. One slot, because there is one player and
 * they can only be looking at one thing.
 */
let pending: Handoff | null = null

/**
 * Sends a ship to whichever scene loads next.
 *
 * Serialised rather than handed over live: the sender is about to be disposed,
 * and a shared Ship would leave the receiver holding grids the old scene still
 * had references into. The file format is already the way a ship survives leaving
 * memory, so it is the way it survives leaving a scene.
 */
export function sendShip(ship: Ship, from: string): void {
    pending = { text: shipToText(ship), from }
}

/**
 * Collects whatever was sent, and clears it.
 *
 * Consumed on read, so a scene entered normally the next time gets nothing and
 * shows no way back - which is what makes the back button mean "you came from
 * somewhere" rather than "somebody once did".
 */
export function takeHandoff(): Handoff | null {
    const taken = pending
    pending = null
    return taken
}

/** The ship a handoff carries. */
export function shipOf(handoff: Handoff): Ship {
    const { ship, warnings } = shipFromText(handoff.text)

    // A handoff is written by this build for this build, so anything wrong with it
    // is a bug here rather than a file someone hand-edited
    for (const warning of warnings) console.warn(`handoff: ${warning}`)

    return ship
}
