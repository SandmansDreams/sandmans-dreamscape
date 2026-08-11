import type { Ship } from "../../game/ship"

/**
 * Every ship in this folder, discovered rather than listed.
 *
 * Dropping a .ts file in here with a default-exported builder is the whole of
 * "add a ship" - no registration step to forget. Same pattern as dev/DevScene.ts.
 * index.ts has no default export, so the filter skips it without a special case.
 */
const modules = import.meta.glob<{ default?: () => Ship }>("./*.ts", { eager: true })

const builders: readonly (() => Ship)[] = Object.values(modules)
    .map((module) => module.default)
    .filter((build): build is () => Ship => build != null)

/**
 * One instance per ship, built at load so a picker can list names without
 * constructing anything itself. Pure CPU - no GPU resources are touched.
 */
export const SHIPS: readonly Ship[] = builders
    .map((build) => build())
    .sort((a, b) => a.name.localeCompare(b.name))

export function findShip(id: string): Ship | undefined {
    return SHIPS.find((ship) => ship.id === id)
}

/**
 * A fresh, independently editable Ship - never the listing copy, which callers
 * would otherwise mutate for everyone.
 */
export function buildShip(id: string): Ship {
    const build = builders.find((make) => make().id === id)
    if (!build) throw new Error(`no ship named "${id}" in assets/ships`)

    return build()
}