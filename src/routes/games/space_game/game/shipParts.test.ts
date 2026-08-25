import { describe, expect, it } from "vitest"
import { separateShip } from "./shipParts"
import { Ship } from "./ship"

/** A hull bar from col 0 to col `to`, with a component riding every plate. */
function bar(to: number): Ship {
    const ship = new Ship("bar", "Bar", "Someone")

    for (let col = 0; col <= to; col++) {
        ship.layers.hull.set(col, 0, "full")
        ship.layers.components.set(col, 0, "full", { type: "ion-thruster" })
        ship.layers.cosmetic.set(col, 0, "full")
    }

    return ship
}

const columns = (ship: Ship) => ship.layers.hull.list.map((cell) => cell.col).sort((a, b) => a - b)

describe("separateShip", () => {
    it("gives back a whole ship untouched", () => {
        const ship = bar(4)
        const parts = separateShip(ship)

        expect(parts).toEqual([ship])
    })

    it("finds both pieces when the hull is cut through", () => {
        const ship = bar(4)
        ship.layers.hull.delete(2, 0)

        const parts = separateShip(ship)

        expect(parts).toHaveLength(2)
        expect(columns(parts[0]!)).toEqual([0, 1])
        expect(columns(parts[1]!)).toEqual([3, 4])
    })

    it("returns the pieces heaviest first", () => {
        const ship = bar(5)
        ship.layers.hull.delete(1, 0)

        const parts = separateShip(ship)

        expect(parts[0]!.mass).toBeGreaterThan(parts[1]!.mass)
        expect(columns(parts[0]!)).toEqual([2, 3, 4, 5])
    })

    it("keeps every cell exactly once, across every layer", () => {
        const ship = bar(4)
        ship.layers.hull.delete(2, 0)

        const parts = separateShip(ship)
        const counted = (layer: "hull" | "components" | "cosmetic") =>
            parts.reduce((total, part) => total + part.layers[layer].size, 0)

        // 5 plates less the one destroyed, and the riders that went with it
        expect(counted("hull")).toBe(4)
        expect(counted("components")).toBe(4)
        expect(counted("cosmetic")).toBe(4)
    })

    it("sends a component with the piece holding the plate under it", () => {
        const ship = bar(4)
        ship.layers.hull.delete(2, 0)

        const [left, right] = separateShip(ship)

        expect(left!.layers.components.has(1, 0)).toBe(true)
        expect(right!.layers.components.has(1, 0)).toBe(false)
        expect(right!.layers.components.has(3, 0)).toBe(true)
    })

    it("drops a rider whose plate was the one destroyed", () => {
        const ship = bar(4)
        ship.layers.hull.delete(2, 0)

        const parts = separateShip(ship)

        // It has nothing left to sit on, so it belongs to neither piece
        expect(parts.some((part) => part.layers.components.has(2, 0))).toBe(false)
    })

    it("copies a cell losslessly rather than rebuilding it from its type", () => {
        const ship = bar(4)
        ship.layers.hull.set(0, 0, "full", { hitPoints: 999, facing: 2, level: 1 })
        ship.layers.hull.delete(2, 0)

        const [, right] = separateShip(ship)
        const [left] = separateShip(ship)
        const cell = left!.layers.hull.get(0, 0)!

        expect(cell.hitPoints).toBe(999)
        expect(cell.facing).toBe(2)
        expect(right!.layers.hull.has(0, 0)).toBe(false)
    })

    it("survives a one-block hull and an empty one", () => {
        const single = new Ship("s", "S")
        single.layers.hull.set(0, 0, "full")

        expect(separateShip(single)).toHaveLength(1)
        expect(separateShip(new Ship("e", "E"))).toHaveLength(1)
    })
})