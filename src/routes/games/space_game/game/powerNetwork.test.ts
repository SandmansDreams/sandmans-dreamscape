import { describe, expect, it } from "vitest"
import { islandAt, powerNetworkOf } from "./powerNetwork"
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