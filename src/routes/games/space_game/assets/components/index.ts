import { readArt, type ComponentArt } from "../../game/componentArt"
import type { Component } from "../../render/grid/components"

const files = import.meta.glob<unknown>("./*.json", { eager: true, import: "default" })

/**
 * The raw files by path, so a test can re-read them and check what they warned.
 *
 * The parsed pieces below drop their warnings on the floor - by design, since a
 * console line is all a running game can do with one. A test wants to assert
 * there were none.
 */
export const ART_FILES: Readonly<Record<string, unknown>> = files

const byId = new Map<string, ComponentArt>()

for (const [path, data] of Object.entries(files)) {
    const { art, warnings } = readArt(data)

    // Reported once at load: a malformed piece should be visible before someone
    // wonders why their turret is a hexagon
    for (const warning of warnings) console.warn(`${path}: ${warning}`)
    byId.set(art.id, art)
}

/**
 * Every piece of art in the game, by the id it is keyed on.
 *
 * For the sprite editor, which lists them to be opened rather than looking one
 * up for a component. Sorted by id so the list does not reshuffle when a file is
 * added - import.meta.glob's order is the filesystem's, not anything stable.
 */
export const ART_PIECES: readonly ComponentArt[] = [...byId.values()]
    .sort((a, b) => a.id.localeCompare(b.id))

/**
 * The art a component wears at a level, or null to fall back to the placeholder.
 *
 * `artIds` yields the level-specific id first, so a level only needs its own file
 * when it genuinely looks different. Everything else falls through to the type's
 * one piece, and a type with no art at all keeps its hexagon.
 */
export function findArt(component: Component, level: number): ComponentArt | null {
    for (const id of component.artIds(level)) {
        const art = byId.get(id)
        if (art) return art
    }

    return null
}