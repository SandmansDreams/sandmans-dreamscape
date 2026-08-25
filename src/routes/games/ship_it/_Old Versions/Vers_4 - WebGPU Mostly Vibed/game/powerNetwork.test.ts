import { describe, expect, it } from "vitest"
import { islandAt, powerNetworkOf, reachedCells, wiresFrom } from "./powerNetwork"
import { Ship } from "./ship"

interface Part {
    type: string
    col: number
    row: number
    level?: number
}

/** A ship carrying exactly the components a test names, and nothing else. */
function shipOf(parts: Part[]): Ship {
    const ship = new Ship("test", "Test Ship")

    for (const part of parts) {
        ship.layers.components.set(part.col, part.row, "full", {
            type: part.type,
            level: part.level ?? 1,
        })
    }

    return ship
}

describe("reach", () => {
    it("powers a consumer at the edge of the radius", () => {
        // fusion-core L1 reaches 6, so 6 cells away is the last powered cell
        const network = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "ion-thruster", col: 6, row: 0 },
        ]))

        expect(islandAt(network, 6, 0)).toBe(0)
    })

    it("leaves a consumer one cell beyond it dark", () => {
        const network = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "ion-thruster", col: 7, row: 0 },
        ]))

        expect(islandAt(network, 7, 0)).toBe(-1)
    })

    it("measures on the diagonal too, not as a square", () => {
        // (5,4) is 6.4 cells out - inside a square of side 6, outside the disc
        const network = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "ion-thruster", col: 5, row: 4 },
        ]))

        expect(islandAt(network, 5, 4)).toBe(-1)
    })

    it("powers a generator's own cell", () => {
        const network = powerNetworkOf(shipOf([{ type: "fusion-core", col: 3, row: 3 }]))

        expect(islandAt(network, 3, 3)).toBe(0)
    })
})

describe("batteries relay", () => {
    it("carries power to a consumer neither part could reach alone", () => {
        // The thruster is 11 cells from the core - far past its reach of 6 - but
        // 5 from the battery, which the core does reach
        const network = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 6, row: 0 },
            { type: "ion-thruster", col: 11, row: 0 },
        ]))

        expect(islandAt(network, 11, 0)).toBe(0)
    })

    it("links whichever way round the pair is placed", () => {
        // Six cells apart is inside the core's reach and outside the battery's,
        // so an asymmetric rule would connect one layout and not its mirror
        const forward = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 6, row: 0 },
        ]))
        const mirrored = powerNetworkOf(shipOf([
            { type: "battery", col: 0, row: 0 },
            { type: "fusion-core", col: 6, row: 0 },
        ]))

        expect(forward.islands).toEqual(mirrored.islands)
        expect(forward.islands).toHaveLength(1)
        expect(forward.islands[0]!.capacity).toBe(56) // 16 buffer + 40 battery
    })

    it("ignores a battery no generator reaches", () => {
        const network = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 50, row: 50 },
        ]))

        expect(network.islands).toHaveLength(1)
        // The buffer alone - counting the stranded battery would claim the ship
        // can hold power that nothing is able to put there
        expect(network.islands[0]!.capacity).toBe(16)
        expect(islandAt(network, 50, 50)).toBe(-1)
    })
})

describe("islands", () => {
    it("keeps two separated generators apart", () => {
        const network = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "fusion-core", col: 30, row: 0 },
        ]))

        expect(network.islands).toHaveLength(2)
        expect(network.islands[0]!.output).toBe(8)
        expect(network.islands[1]!.output).toBe(8)
    })

    it("merges two generators that reach each other", () => {
        const network = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "fusion-core", col: 5, row: 0 },
        ]))

        expect(network.islands).toHaveLength(1)
        expect(network.islands[0]!.output).toBe(16)
        expect(network.islands[0]!.capacity).toBe(32)
    })

    it("puts a consumer reached by two islands on the nearer one", () => {
        // Cores 11 apart, so they do not link. The thruster is 5 from the left
        // one and 6 from the right - inside both, nearer the left.
        const parts: Part[] = [
            { type: "fusion-core", col: 0, row: 0 },
            { type: "fusion-core", col: 11, row: 0 },
            { type: "ion-thruster", col: 5, row: 0 },
        ]
        const network = powerNetworkOf(shipOf(parts))

        expect(network.islands).toHaveLength(2)
        expect(islandAt(network, 5, 0)).toBe(islandAt(network, 0, 0))
    })

    it("gives the same answer every time it is asked", () => {
        const parts: Part[] = [
            { type: "fusion-core", col: 0, row: 0 },
            { type: "fusion-core", col: 11, row: 0 },
            { type: "ion-thruster", col: 5, row: 0 },
        ]

        const first = powerNetworkOf(shipOf(parts))
        const again = powerNetworkOf(shipOf(parts))

        expect(again.islandByCell).toEqual(first.islandByCell)
    })
})

describe("degenerate ships", () => {
    it("has no islands when there is nothing aboard", () => {
        const network = powerNetworkOf(new Ship("test", "Empty"))

        expect(network.islands).toEqual([])
        expect(islandAt(network, 0, 0)).toBe(-1)
    })

    it("has no islands with consumers and no generator", () => {
        const network = powerNetworkOf(shipOf([
            { type: "ion-thruster", col: 0, row: 0 },
            { type: "autocannon", col: 1, row: 0 },
        ]))

        expect(network.islands).toEqual([])
        expect(islandAt(network, 0, 0)).toBe(-1)
    })

    it("has no islands with batteries and no generator", () => {
        const network = powerNetworkOf(shipOf([
            { type: "battery", col: 0, row: 0 },
            { type: "battery", col: 2, row: 0 },
        ]))

        expect(network.islands).toEqual([])
    })

    it("treats a fuel tank as neither a source nor a consumer", () => {
        const network = powerNetworkOf(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "fuel-tank", col: 1, row: 0 },
        ]))

        expect(network.islands).toHaveLength(1)
        expect(islandAt(network, 1, 0)).toBe(-1)
    })
})
describe("wires", () => {
    const wires = (ship: Ship, col: number, row: number) => wiresFrom(ship, "components", col, row)
    const between = (links: ReturnType<typeof wiresFrom>, a: [number, number], b: [number, number]) =>
        links.some((l) =>
            (l.from.col === a[0] && l.from.row === a[1] && l.to.col === b[0] && l.to.row === b[1])
            || (l.from.col === b[0] && l.from.row === b[1] && l.to.col === a[0] && l.to.row === a[1]))

    it("runs from a generator to what it feeds", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "ion-thruster", col: 4, row: 0 },
        ])

        expect(between(wires(ship, 0, 0), [0, 0], [4, 0])).toBe(true)
    })

    it("carries on through a battery to what only the battery reaches", () => {
        // The extension the battery exists for: the core cannot reach the engine,
        // and the wire has to show that the battery is what closes the gap
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 6, row: 0 },
            { type: "ion-thruster", col: 11, row: 0 },
        ])
        const links = wires(ship, 0, 0)

        expect(between(links, [0, 0], [6, 0])).toBe(true)
        expect(between(links, [6, 0], [11, 0])).toBe(true)
        // And not straight there, because nothing reaches that far on its own
        expect(between(links, [0, 0], [11, 0])).toBe(false)
    })

    it("marks a relay run apart from the last hop", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 6, row: 0 },
            { type: "ion-thruster", col: 11, row: 0 },
        ])
        const links = wires(ship, 0, 0)

        expect(links.find((l) => l.to.col === 6)!.relay).toBe(true)
        expect(links.find((l) => l.to.col === 11)!.relay).toBe(false)
    })

    it("chains battery to battery", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 5, row: 0 },
            { type: "battery", col: 10, row: 0 },
            { type: "ion-thruster", col: 14, row: 0 },
        ])
        const links = wires(ship, 0, 0)

        expect(between(links, [5, 0], [10, 0])).toBe(true)
        expect(between(links, [10, 0], [14, 0])).toBe(true)
    })

    it("reaches each source once rather than drawing every link that exists", () => {
        // Three sources all in range of each other would be three wires for one
        // supply, which reads as a loop instead of as a route
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 1, row: 0 },
            { type: "battery", col: 2, row: 0 },
        ])
        const relays = wires(ship, 0, 0).filter((l) => l.relay)

        expect(relays).toHaveLength(2)
    })

    it("traces back the other way from a consumer", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 6, row: 0 },
            { type: "ion-thruster", col: 11, row: 0 },
        ])
        const links = wires(ship, 11, 0)

        expect(between(links, [6, 0], [11, 0])).toBe(true)
        expect(between(links, [0, 0], [6, 0])).toBe(true)
    })

    it("draws nothing for a part nothing reaches", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "ion-thruster", col: 40, row: 0 },
        ])

        expect(wires(ship, 40, 0)).toEqual([])
    })

    it("draws nothing for a battery no generator reaches", () => {
        const ship = shipOf([{ type: "battery", col: 0, row: 0 }])
        expect(wires(ship, 0, 0).filter((l) => l.relay)).toEqual([])
    })
})

describe("wire direction", () => {
    /** Every link, as "fromCol->toCol", so orientation is readable in a failure. */
    const arrows = (links: ReturnType<typeof wiresFrom>) =>
        links.map((l) => `${l.from.col}->${l.to.col}`)

    const CHAIN = [
        { type: "fusion-core", col: 0, row: 0 },
        { type: "battery", col: 5, row: 0 },
        { type: "battery", col: 10, row: 0 },
        { type: "ion-thruster", col: 14, row: 0 },
    ]

    it("points downstream from the generator when a source is selected", () => {
        expect(arrows(wiresFrom(shipOf(CHAIN), "components", 0, 0)))
            .toEqual(["0->5", "5->10", "10->14"])
    })

    it("still points downstream when traced back from the consumer", () => {
        // The whole reason the tree is rooted at generators: a pulse animated
        // along one of these must not run backwards up the wire
        expect(arrows(wiresFrom(shipOf(CHAIN), "components", 14, 0)))
            .toEqual(["0->5", "5->10", "10->14"])
    })

    it("shows only what is downstream of a selected battery", () => {
        // Selecting the middle battery is asking what *it* carries, not what the
        // whole island does - the core above it is not its business
        expect(arrows(wiresFrom(shipOf(CHAIN), "components", 5, 0)))
            .toEqual(["5->10", "10->14"])
    })

    it("hangs a battery off the nearer of two generators", () => {
        const links = wiresFrom(shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 4, row: 0 },
            { type: "fusion-core", col: 20, row: 0 },
        ]), "components", 0, 0)

        expect(arrows(links)).toContain("0->4")
    })
})

describe("what gets a wire at all", () => {
    /** A ship with a core, and whatever else the test names, on the hull layer too. */
    function withHull(parts: Part[]): Ship {
        const ship = shipOf(parts)
        for (const part of parts) ship.layers.hull.set(part.col, part.row, "full")
        return ship
    }

    it("draws nothing for a hull plate", () => {
        // A plate is not wired to anything because it needs nothing, and a line to
        // it would claim a demand that is not there
        const ship = withHull([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "ion-thruster", col: 3, row: 0 },
        ])

        expect(wiresFrom(ship, "hull", 3, 0)).toEqual([])
    })

    it("draws nothing for a crate", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "crate", col: 3, row: 0 },
        ])

        expect(wiresFrom(ship, "components", 3, 0)).toEqual([])
    })

    it("still draws for the thruster sitting on that same plate", () => {
        const ship = withHull([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "ion-thruster", col: 3, row: 0 },
        ])

        expect(wiresFrom(ship, "components", 3, 0).length).toBeGreaterThan(0)
    })

    it("draws nothing for a cell that is not there", () => {
        expect(wiresFrom(shipOf([]), "components", 9, 9)).toEqual([])
    })
})

describe("several feeders", () => {
    const feeders = (links: ReturnType<typeof wiresFrom>, col: number) =>
        links.filter((l) => !l.relay && l.to.col === col).length

    it("wires a part to every battery it sits between", () => {
        // Sitting between two of them it really is fed by both, and one line
        // would be claiming otherwise
        // The core is seven out and reaches six, so the only things feeding this
        // thruster are the two batteries either side of it
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 5, row: 0 },
            { type: "battery", col: 9, row: 0 },
            { type: "ion-thruster", col: 7, row: 0 },
        ])

        expect(feeders(wiresFrom(ship, "components", 0, 0), 7)).toBe(2)
    })

    it("stops at three batteries however many are in reach", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 2, row: 0 },
            { type: "battery", col: 3, row: 0 },
            { type: "battery", col: 4, row: 0 },
            { type: "battery", col: 5, row: 0 },
            { type: "battery", col: 6, row: 0 },
            { type: "ion-thruster", col: 4, row: 1 },
        ])
        const links = wiresFrom(ship, "components", 0, 0)

        // Three batteries, plus the core which is also in range of it
        expect(feeders(links, 4)).toBe(4)
    })

    it("counts a generator that is also in reach as a feeder", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 3, row: 0 },
            { type: "ion-thruster", col: 4, row: 0 },
        ])

        // The battery beside it and the core behind it, both in range
        expect(feeders(wiresFrom(ship, "components", 0, 0), 4)).toBe(2)
    })

    it("wires straight to the generator when no battery is in reach", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "ion-thruster", col: 3, row: 0 },
        ])

        expect(feeders(wiresFrom(ship, "components", 0, 0), 3)).toBe(1)
    })

    it("traces every feeder back when the part itself is selected", () => {
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 5, row: 0 },
            { type: "battery", col: 9, row: 0 },
            { type: "ion-thruster", col: 7, row: 0 },
        ])

        expect(feeders(wiresFrom(ship, "components", 7, 0), 7)).toBe(2)
    })

    it("does not draw a shared branch twice", () => {
        // Both batteries hang off the same core, so the run to it is one wire
        const ship = shipOf([
            { type: "fusion-core", col: 0, row: 0 },
            { type: "battery", col: 5, row: 0 },
            { type: "battery", col: 9, row: 0 },
            { type: "ion-thruster", col: 7, row: 0 },
        ])
        const relays = wiresFrom(ship, "components", 7, 0).filter((l) => l.relay)
        const keys = new Set(relays.map((l) => `${l.from.col}>${l.to.col}`))

        expect(keys.size).toBe(relays.length)
    })
})

describe("showing a source's reach", () => {
    const has = (cells: { col: number; row: number }[], col: number, row: number) =>
        cells.some((c) => c.col === col && c.row === row)

    it("includes a cell exactly on the boundary", () => {
        // fusion-core reaches 6, and 6 away is in. This is the question a drawn
        // circle cannot answer and the reason the cells are marked instead
        const ship = shipOf([{ type: "fusion-core", col: 0, row: 0 }])
        const cells = reachedCells(ship, "components", 0, 0)

        expect(has(cells, 6, 0)).toBe(true)
        expect(has(cells, 7, 0)).toBe(false)
    })

    it("is a disc, not a square", () => {
        const ship = shipOf([{ type: "fusion-core", col: 0, row: 0 }])
        const cells = reachedCells(ship, "components", 0, 0)

        // The corner of a 6-box is 8.5 out, well past the reach
        expect(has(cells, 6, 6)).toBe(false)
        expect(has(cells, 4, 4)).toBe(true)
    })

    it("includes the source's own cell", () => {
        const ship = shipOf([{ type: "battery", col: 2, row: 3 }])
        expect(has(reachedCells(ship, "components", 2, 3), 2, 3)).toBe(true)
    })

    it("grows with the level", () => {
        const one = shipOf([{ type: "battery", col: 0, row: 0 }])
        const two = shipOf([{ type: "battery", col: 0, row: 0, level: 2 }])

        expect(reachedCells(two, "components", 0, 0).length)
            .toBeGreaterThan(reachedCells(one, "components", 0, 0).length)
    })

    it("shows nothing for anything without a reach", () => {
        const ship = shipOf([
            { type: "ion-thruster", col: 0, row: 0 },
            { type: "crate", col: 1, row: 0 },
        ])

        expect(reachedCells(ship, "components", 0, 0)).toEqual([])
        expect(reachedCells(ship, "components", 1, 0)).toEqual([])
    })
})

describe("more than one thing feeding a battery", () => {
    /** Three cores in a row, all within reach of the one battery below them. */
    const SHARED = [
        { type: "fusion-core", col: -1, row: 1 },
        { type: "fusion-core", col: 0, row: 1 },
        { type: "fusion-core", col: 1, row: 1 },
        { type: "battery", col: 0, row: 0 },
    ]

    it("shows the link from every core that reaches it", () => {
        // The bug this exists for: a single-parent tree gave the battery to
        // whichever core it visited first, and the other two looked wired to
        // nothing despite feeding it just as much
        for (const col of [-1, 0, 1]) {
            const relays = wiresFrom(shipOf(SHARED), "components", col, 1).filter((l) => l.relay)

            expect(relays.map((l) => `${l.to.col},${l.to.row}`)).toEqual(["0,0"])
        }
    })

    it("traces every core back from a part the battery feeds", () => {
        const ship = shipOf([...SHARED, { type: "ion-thruster", col: 0, row: -3 }])
        const relays = wiresFrom(ship, "components", 0, -3).filter((l) => l.relay)

        expect(relays).toHaveLength(3)
    })

    it("still points downstream with several feeders", () => {
        const links = wiresFrom(shipOf(SHARED), "components", 0, 0)
        // Selecting the battery shows what it carries, never the cores above it
        expect(links.filter((l) => l.relay)).toEqual([])
    })
})
