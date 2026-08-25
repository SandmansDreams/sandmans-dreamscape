import type { Ship } from "../../_Old Versions/Vers_4 - WebGPU Mostly Vibed/game/ship"
import { readShip } from "../../_Old Versions/Vers_4 - WebGPU Mostly Vibed/game/shipJson"

/**
 * Every ship in this folder, discovered rather than listed.
 *
 * Dropping a .json file in here is the whole of "add a ship" - no registration
 * step to forget, and the same file the editor downloads is the one that loads.
 */
const files = import.meta.glob<unknown>("./*.json", { eager: true, import: "default" })

/** Raw file contents by id, so buildShip can re-read rather than deep-copy. */
const byId = new Map<string, unknown>()

/**
 * One parsed instance per ship, for the picker to list without constructing
 * anything itself. Pure CPU - no GPU resources are touched.
 */
export const SHIPS: readonly Ship[] = Object.entries(files)
    .map(([path, data]) => {
        const { ship, warnings } = readShip(data)

        // Reported once at load rather than silently: a malformed ship should be
        // visible before someone wonders where their blocks went
        for (const warning of warnings) console.warn(`${path}: ${warning}`)

        byId.set(ship.id, data)
        return ship
    })
    .sort((a, b) => a.name.localeCompare(b.name))

export function findShip(id: string): Ship | undefined {
    return SHIPS.find((ship) => ship.id === id)
}

/**
 * A fresh, independently editable Ship - never the listing copy, which callers
 * would otherwise mutate for everyone.
 *
 * Throws on an unknown id: that is a typo in code rather than bad user data, and
 * it should not degrade quietly into an empty ship.
 */
export function buildShip(id: string): Ship {
    const data = byId.get(id)
    if (!data) throw new Error(`no ship named "${id}" in assets/ships`)

    return readShip(data).ship
}
