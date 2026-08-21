// Which parts of a ship a generator can actually feed

import {
    BatteryComponent,
    componentById,
    GeneratorComponent,
    ProjectorComponent,
    ThrusterComponent,
    WeaponComponent,
    type Component,
} from "../render/grid/components"
import { cellKey } from "../render/grid/grid"
import type { Ship } from "./ship"

/** One connected run of generators and the batteries relaying for them. */
export interface PowerIsland {
    /** Power per second every generator on it makes at full output. */
    output: number
    /** The most it can hold: generator buffers plus battery capacity. */
    capacity: number
    /** Fuel per second every generator on it burns at full output. */
    burn: number
}

export interface PowerNetwork {
    islands: readonly PowerIsland[]
    /** Island index by packed cell key. Absent means on no network at all. */
    islandByCell: ReadonlyMap<number, number>
}

/** A generator or battery, flattened to what the network cares about. */
interface Source {
    col: number
    row: number
    reach: number
    /** Power per second. Zero for a battery, which makes none. */
    output: number
    /** Fuel per second at full output. Zero for a battery, which burns none. */
    burn: number
    /** Power held: a generator's buffer, or a battery's capacity. */
    capacity: number
    /** Generators seed islands. A battery only joins one that reaches it. */
    root: boolean
}

/**
 * True for a component that spends power - the things a network has to reach.
 *
 * Here rather than on Component because it is the *network's* definition of a
 * consumer, and the registry has no opinion about power. If a fourth kind of
 * consumer ever appears this is the one line that has to know.
 */
export function drawsPower(component: Component): boolean {
    return component instanceof ThrusterComponent
        || component instanceof WeaponComponent
        || component instanceof ProjectorComponent
}

/**
 * Squared distance between two cells.
 *
 * Squared because every test here is against a squared reach, so no sqrt is
 * needed. Cell *centres* rather than corners, but both carry the same +0.5 so it
 * cancels and this reduces to the integer difference.
 */
function distanceSquared(a: Source, col: number, row: number): number {
    const dc = a.col - col
    const dr = a.row - row
    return dc * dc + dr * dr
}

/**
 * Whether two sources are on the same bus.
 *
 * Deliberately symmetric - either one reaching the other links them. An
 * asymmetric rule would mean swapping a core and a battery could change what is
 * powered, which is not something a player could ever learn.
 */
function linked(a: Source, b: Source): boolean {
    const range = Math.max(a.reach, b.reach)
    return distanceSquared(a, b.col, b.row) <= range * range
}

function sourcesOf(ship: Ship): Source[] {
    const sources: Source[] = []

    for (const grid of ship.layersOf()) {
        for (const cell of grid.list) {
            const component = componentById(cell.type)

            if (component instanceof GeneratorComponent) {
                const stats = component.statsAt(cell.level)
                sources.push({
                    col: cell.col,
                    row: cell.row,
                    reach: stats.reach,
                    output: stats.power,
                    burn: stats.burn,
                    capacity: stats.buffer,
                    root: true,
                })
            } else if (component instanceof BatteryComponent) {
                const stats = component.statsAt(cell.level)
                sources.push({
                    col: cell.col,
                    row: cell.row,
                    reach: stats.reach,
                    output: 0,
                    burn: 0,
                    capacity: stats.capacity,
                    root: false,
                })
            }
        }
    }

    return sources
}

/**
 * The island a cell should draw from: the nearest source that reaches it.
 *
 * Nearest rather than first-found so the answer cannot depend on the order cells
 * happen to sit in the grid, and the island index breaks a remaining tie. Between
 * them the assignment is the same on every call, which is what stops a consumer
 * flickering between two islands frame to frame.
 */
function islandNear(
    sources: readonly Source[],
    islandOf: readonly number[],
    col: number,
    row: number,
): number {
    let best = -1
    let bestDistance = Infinity

    for (let i = 0; i < sources.length; i++) {
        const island = islandOf[i]!
        if (island < 0) continue

        const source = sources[i]!
        const distance = distanceSquared(source, col, row)
        if (distance > source.reach * source.reach) continue

        if (distance < bestDistance || (distance === bestDistance && island < best)) {
            best = island
            bestDistance = distance
        }
    }

    return best
}

/**
 * Who can power what on this ship.
 *
 * A generator radiates power `reach` cells. A battery inside that radius becomes
 * a relay and radiates its own, and so on until nothing new joins - so batteries
 * are how power travels down a long hull, not just a bigger tank.
 *
 * A battery no generator reaches is on no island at all: nothing can charge it,
 * so counting its capacity would be a lie about what the ship can hold.
 *
 * O(sources² + consumers × sources). A 200-block ship has about ten sources and
 * twenty consumers, so this is a few hundred comparisons on an edit - a spatial
 * index would cost more to maintain than it saves. That stops being true somewhere
 * north of a thousand sources, which no ship is going to have.
 */
export function powerNetworkOf(ship: Ship): PowerNetwork {
    const sources = sourcesOf(ship)
    const islandOf = new Array<number>(sources.length).fill(-1)
    const islands: PowerIsland[] = []

    for (let seed = 0; seed < sources.length; seed++) {
        if (!sources[seed]!.root || islandOf[seed]! >= 0) continue

        const index = islands.length
        const island: PowerIsland = { output: 0, capacity: 0, burn: 0 }
        islands.push(island)

        // Flood outward from this generator. Visit order does not matter - all
        // that comes out is the connected set - so the frontier is walked with an
        // index rather than shifted off the front.
        const frontier = [seed]
        islandOf[seed] = index
        island.output += sources[seed]!.output
        island.capacity += sources[seed]!.capacity
        island.burn += sources[seed]!.burn

        for (let head = 0; head < frontier.length; head++) {
            const at = sources[frontier[head]!]!

            for (let next = 0; next < sources.length; next++) {
                if (islandOf[next]! >= 0 || !linked(at, sources[next]!)) continue

                islandOf[next] = index
                island.output += sources[next]!.output
                island.capacity += sources[next]!.capacity
                island.burn += sources[next]!.burn
                frontier.push(next)
            }
        }
    }

    const islandByCell = new Map<number, number>()

    // Sources are on their own island by definition, so they are placed directly
    // rather than being asked which island reaches them
    for (let i = 0; i < sources.length; i++) {
        const island = islandOf[i]!
        if (island >= 0) islandByCell.set(cellKey(sources[i]!.col, sources[i]!.row), island)
    }

    for (const grid of ship.layersOf()) {
        for (const cell of grid.list) {
            if (!drawsPower(componentById(cell.type))) continue

            const island = islandNear(sources, islandOf, cell.col, cell.row)
            if (island >= 0) islandByCell.set(cellKey(cell.col, cell.row), island)
        }
    }

    return { islands, islandByCell }
}

/** The island a cell draws from, or -1 for one nothing reaches. */
export function islandAt(network: PowerNetwork, col: number, row: number): number {
    return network.islandByCell.get(cellKey(col, row)) ?? -1
}