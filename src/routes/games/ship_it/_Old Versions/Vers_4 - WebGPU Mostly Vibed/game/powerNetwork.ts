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
import type { ShipLayer } from "../render/grid/layers"
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
/** One run of wire between two cells, for showing how power gets somewhere. */
export interface PowerLink {
    from: { col: number; row: number }
    to: { col: number; row: number }
    /**
     * True between two sources, false where wire meets something that spends.
     *
     * The distinction is worth drawing: a relay run is the trunk a battery
     * extends, and a consumer run is the last hop off it.
     */
    relay: boolean
}

/**
 * How power reaches things, as seen from one selected cell.
 *
 * Select a generator or a battery and this is everything downstream of it: the
 * chain of batteries carrying its reach outward, and the last hop from each of
 * those to whatever it feeds. Select a thruster or a gun and it is the run that
 * feeds it, traced back to the generator paying for it.
 *
 * Every link points the way power actually travels, generator outward, whichever
 * end you selected. That is what lets something be animated along one: a pulse
 * running backwards up a wire would be worse than no pulse at all.
 *
 * A tree rather than every link that exists. Two batteries in range of each
 * other and of the same core would draw three wires for one supply, which says
 * "there is a loop here" when what a player asked was "where does this come
 * from" - so each source is reached once, by the shortest hop from a generator.
 *
 * Empty when the cell is on no network, which is the honest answer: an orphaned
 * turret has no wire to draw because nothing is feeding it.
 */
export function wiresFrom(ship: Ship, layer: ShipLayer, col: number, row: number): PowerLink[] {
    const cell = ship.layers[layer].get(col, row)
    if (!cell) return []

    const component = componentById(cell.type)
    const sources = sourcesOf(ship)
    const depth = feedDepths(sources)

    if (component instanceof GeneratorComponent || component instanceof BatteryComponent) {
        const at = sources.findIndex((source) => source.col === col && source.row === row)
        return at >= 0 ? wiresUnder(ship, sources, depth, at) : []
    }

    // Everything else only has a supply worth drawing if it actually spends
    // something. A hull plate or a crate is wired to nothing because it needs
    // nothing, and a line to it would claim a demand that is not there.
    if (!drawsPower(component)) return []

    return wiresFeeding(ship, sources, depth, col, row)
}

/**
 * The most batteries one part is shown drawing from.
 *
 * More than one because a part sitting between two of them really is fed by
 * both, and a single line would claim otherwise. Capped because past three the
 * picture stops being a supply and starts being a mesh.
 */
const MAX_BATTERY_LINKS = 3

/**
 * Which sources a part draws through, nearest first.
 *
 * Batteries before the generator: a battery is what a part is meant to be fed
 * from, and the generator behind it is the supply of last resort - so a hull
 * wired properly shows short local runs rather than everything reaching back to
 * the core. A generator still connects directly when it is in range, which is
 * what keeps a ship with no batteries working at all.
 */
function feedersFor(
    sources: readonly Source[],
    included: readonly boolean[],
    col: number,
    row: number,
): number[] {
    const inRange = sources
        .map((source, index) => ({ index, source, away: distanceSquared(source, col, row) }))
        .filter((entry) =>
            included[entry.index] && entry.away <= entry.source.reach * entry.source.reach)
        .sort((a, b) => a.away - b.away)

    const feeders = inRange
        .filter((entry) => !entry.source.root)
        .slice(0, MAX_BATTERY_LINKS)
        .map((entry) => entry.index)

    const generator = inRange.find((entry) => entry.source.root)
    if (generator) feeders.push(generator.index)

    return feeders
}

/**
 * How many hops each source is from the nearest generator.
 *
 * Generators are 0, a battery they reach is 1, and so on; Infinity means nothing
 * feeds it. Depth is what gives the wiring a direction without inventing a
 * single parent for anything: power flows from a lower depth to a higher one,
 * and a source can be fed by every shallower source that reaches it.
 *
 * That last part is why this replaced a tree. Three cores in a row all reaching
 * the same battery really do all feed it, and a tree could only say so about
 * whichever one it happened to visit first - leaving the other two looking wired
 * to nothing at all.
 */
function feedDepths(sources: readonly Source[]): number[] {
    const depth = sources.map((source) => (source.root ? 0 : Infinity))
    const frontier = sources.map((_, index) => index).filter((index) => depth[index] === 0)

    for (let head = 0; head < frontier.length; head++) {
        const here = frontier[head]!

        for (let next = 0; next < sources.length; next++) {
            if (depth[next] !== Infinity || !linked(sources[here]!, sources[next]!)) continue

            depth[next] = depth[here]! + 1
            frontier.push(next)
        }
    }

    return depth
}

/** Every source that feeds this one: shallower than it, and in reach of it. */
function feedsInto(sources: readonly Source[], depth: readonly number[], into: number): number[] {
    const feeders: number[] = []
    if (depth[into] === Infinity) return feeders

    for (let i = 0; i < sources.length; i++) {
        if (depth[i]! < depth[into]! && linked(sources[i]!, sources[into]!)) feeders.push(i)
    }

    return feeders
}

/** Every source the power leaving this one can reach, itself included. */
function downstreamOf(sources: readonly Source[], depth: readonly number[], from: number): boolean[] {
    const under = sources.map(() => false)
    if (depth[from] === Infinity) return under

    under[from] = true
    const frontier = [from]

    // Depth strictly increases along a feed, so this cannot loop back on itself
    for (let head = 0; head < frontier.length; head++) {
        const here = frontier[head]!

        for (let next = 0; next < sources.length; next++) {
            if (under[next] || depth[next]! <= depth[here]!) continue
            if (!linked(sources[here]!, sources[next]!)) continue

            under[next] = true
            frontier.push(next)
        }
    }

    return under
}

/** Everything the selected source carries power to, directly or through a relay. */
function wiresUnder(
    ship: Ship,
    sources: readonly Source[],
    depth: readonly number[],
    from: number,
): PowerLink[] {
    if (depth[from] === Infinity) return []

    const links: PowerLink[] = []
    const under = downstreamOf(sources, depth, from)

    // Only feeds that both start and end downstream, so the run begins at the
    // selection rather than at whatever happens to feed it
    sources.forEach((source, index) => {
        if (!under[index]) return

        for (const feeder of feedsInto(sources, depth, index)) {
            if (!under[feeder]) continue

            links.push({
                from: { col: sources[feeder]!.col, row: sources[feeder]!.row },
                to: { col: source.col, row: source.row },
                relay: true,
            })
        }
    })

    for (const cell of consumerCells(ship)) {
        for (const feeder of feedersFor(sources, under, cell.col, cell.row)) {
            links.push({
                from: { col: sources[feeder]!.col, row: sources[feeder]!.row },
                to: { col: cell.col, row: cell.row },
                relay: false,
            })
        }
    }

    return links
}

/** The runs that feed one consumer, traced back to the generators paying for it. */
function wiresFeeding(
    ship: Ship,
    sources: readonly Source[],
    depth: readonly number[],
    col: number,
    row: number,
): PowerLink[] {
    const onNetwork = depth.map((d) => d !== Infinity)
    const feeders = feedersFor(sources, onNetwork, col, row)
    if (feeders.length === 0) return []

    const relays: PowerLink[] = []
    const seen = new Set<string>()
    const walk = [...feeders]

    // Upstream from every feeder at once, deduped: two feeders on one branch
    // share most of it, and drawing that twice draws it thicker, not fuller
    for (let head = 0; head < walk.length; head++) {
        const here = walk[head]!

        for (const feeder of feedsInto(sources, depth, here)) {
            const key = `${feeder}>${here}`
            if (seen.has(key)) continue

            seen.add(key)
            relays.push({
                from: { col: sources[feeder]!.col, row: sources[feeder]!.row },
                to: { col: sources[here]!.col, row: sources[here]!.row },
                relay: true,
            })
            walk.push(feeder)
        }
    }

    // Shallowest first, so the run still reads generator outward however far up
    // from the consumer it was found
    relays.sort((a, b) => depthOfCell(sources, depth, a.from) - depthOfCell(sources, depth, b.from))

    return [
        ...relays,
        ...feeders.map((feeder) => ({
            from: { col: sources[feeder]!.col, row: sources[feeder]!.row },
            to: { col, row },
            relay: false,
        })),
    ]
}

function depthOfCell(
    sources: readonly Source[],
    depth: readonly number[],
    at: { col: number; row: number },
): number {
    const index = sources.findIndex((source) => source.col === at.col && source.row === at.row)
    return index >= 0 ? depth[index]! : Infinity
}
function consumerCells(ship: Ship): { col: number; row: number }[] {
    const cells: { col: number; row: number }[] = []

    for (const grid of ship.layersOf()) {
        for (const cell of grid.list) {
            if (drawsPower(componentById(cell.type))) cells.push({ col: cell.col, row: cell.row })
        }
    }

    return cells
}

/**
 * Every cell a selected source reaches, as grid coordinates.
 *
 * The cells themselves rather than a circle drawn at its radius. Reach is tested
 * centre to centre against a squared distance, so whether a cell on the boundary
 * counts is a yes or a no - and a circle drawn over a blocky grid leaves exactly
 * that question open, with the answer differing by a pixel. A cell either lights
 * up or it does not, which is what the network actually decides.
 *
 * Empty for anything that is not a generator or a battery: nothing else has a
 * reach to show.
 */
export function reachedCells(
    ship: Ship,
    layer: ShipLayer,
    col: number,
    row: number,
): { col: number; row: number }[] {
    const cell = ship.layers[layer].get(col, row)
    if (!cell) return []

    const component = componentById(cell.type)
    const reach = component instanceof GeneratorComponent || component instanceof BatteryComponent
        ? component.statsAt(cell.level).reach
        : 0

    if (reach <= 0) return []

    const cells: { col: number; row: number }[] = []
    const span = Math.floor(reach)

    // A box, filtered to the disc: the alternative is walking outward ring by
    // ring, which is more code to visit the same cells
    for (let dr = -span; dr <= span; dr++) {
        for (let dc = -span; dc <= span; dc++) {
            if (dc * dc + dr * dr > reach * reach) continue
            cells.push({ col: col + dc, row: row + dr })
        }
    }

    return cells
}
