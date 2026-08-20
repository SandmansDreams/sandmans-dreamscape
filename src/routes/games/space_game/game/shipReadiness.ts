// What a ship has to be before it is worth saving

import type { ComponentKind } from "../render/grid/components"
import type { Ship } from "./ship"

/** One thing wrong with a ship, in the words the builder shows. */
export interface Issue {
    /** Stable, for a test or a panel that wants to point at one. */
    id: string
    /** Written for whoever is building the ship, not for a log. */
    message: string
}

/** How many of each category a ship carries, across every layer. */
export type KindCounts = Record<ComponentKind, number>

export function countKinds(ship: Ship): KindCounts {
    const counts = { hull: 0, thruster: 0, cargo: 0, generator: 0, projector: 0, weapon: 0 }

    for (const grid of ship.layersOf()) {
        for (const kind of Object.keys(counts) as ComponentKind[]) {
            counts[kind] += grid.ofKind(kind).length
        }
    }

    return counts
}

/**
 * What is wrong with the ship itself, ignoring what it is called.
 *
 * Split from the name check because the two are known in different places: the
 * hull is the scene's, and the name being typed into the download dialog is the
 * panel's and is not committed yet. Each side checks what it holds.
 *
 * Advisory by design. These rules are about a ship being *finished*, not about
 * the file being valid - a half-built hull saves and loads perfectly well, it
 * just cannot fly, which is what these say out loud before someone finds out in
 * the flight sim.
 */
export function structuralIssues(ship: Ship): Issue[] {
    const issues: Issue[] = []
    const counts = countKinds(ship)
    const blocks = ship.layersOf().reduce((sum, grid) => sum + grid.size, 0)

    if (blocks === 0) {
        // Nothing else is worth saying about an empty grid
        return [{ id: "empty", message: "This ship has no blocks yet." }]
    }

    if (counts.thruster === 0) {
        issues.push({ id: "no-thruster", message: "No thrusters - this hull cannot move." })
    }

    if (counts.generator === 0) {
        issues.push({
            id: "no-generator",
            // Named for the thruster because that is the part the builder just
            // placed and is wondering about
            message: counts.thruster === 0
                ? "No generators - nothing aboard makes power."
                : "No generators - the thrusters have nothing to draw power from.",
        })
    }

    return issues
}

/** The one rule about the name, checked wherever the pending name lives. */
export function nameIssue(name: string): Issue | null {
    return name.trim() === "" ? { id: "unnamed", message: "Give the ship a name." } : null
}

/**
 * Everything standing between this ship and a file.
 *
 * Empty means ready. Reported as a list rather than a single verdict, because a
 * hull missing three things should say so once instead of over three attempts.
 */
export function issuesFor(ship: Ship, name = ship.name): Issue[] {
    const structural = structuralIssues(ship)

    // An empty grid says one thing and stops; adding "and name it" to that is
    // piling on rather than helping
    if (structural[0]?.id === "empty") return structural

    const named = nameIssue(name)
    return named ? [named, ...structural] : structural
}

/** True when nothing is standing in the way. */
export function isReady(ship: Ship, name = ship.name): boolean {
    return issuesFor(ship, name).length === 0
}
