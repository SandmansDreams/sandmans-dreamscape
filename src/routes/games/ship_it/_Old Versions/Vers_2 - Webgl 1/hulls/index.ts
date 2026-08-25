import type { Grid } from "../../render/grid"
import { loadHull, type HullData } from "../../render/hull"

/**
 * Every hull in this folder, discovered rather than listed.
 *
 * Dropping a JSON file in here is the whole of "add a ship" — no registration
 * step to forget. `import.meta.glob` is a Vite feature, which covers the app
 * and Vitest but not the `tsx` dev CLIs, so it stays confined to this file.
 */

const modules = import.meta.glob("./*.json", { eager: true, import: "default" })

export interface HullEntry {
    /** Filename without the extension. */
    id: string
    /** Label for the picker: the file's `name`, else the id made readable. */
    name: string
    data: HullData
}

/** "scytheShip" to "Scythe Ship". */
function labelFromId(id: string): string {
    return id
        .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
        .replace(/^./, first => first.toUpperCase())
}

export const HULLS: readonly HullEntry[] = Object.entries(modules)
    .map(([path, data]) => {
        const id = path.replace(/^\.\//, "").replace(/\.json$/, "")
        const hull = data as HullData

        return { id, name: hull.name || labelFromId(id), data: hull }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

export function findHull(id: string): HullEntry | undefined {
    return HULLS.find(entry => entry.id === id)
}

/**
 * Builds a fresh, independently editable Grid for a hull.
 *
 * Throws on an unknown id — that is a typo in code, not bad user data, and it
 * should not degrade quietly into an empty ship.
 */
export function buildHull(id: string): Grid {
    const entry = findHull(id)
    if (!entry) throw new Error(`no hull named "${id}" in engine/hulls`)

    return loadHull(entry.data, id)
}
