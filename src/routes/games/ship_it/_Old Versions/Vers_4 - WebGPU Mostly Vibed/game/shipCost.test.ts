import { describe, expect, it } from "vitest"
import { Ship } from "./ship"
import { costByKind, shipCost } from "./shipCost"

/** A hull block, plus whatever components the test asks for. */
function shipWith(types: string[] = []): Ship {
    const ship = new Ship("test", "Test Ship")
    ship.layers.hull.set(0, 0, "full")

    types.forEach((type, index) => {
        ship.layers.components.set(index, 0, "full", { type })
    })

    return ship
}

describe("ship cost", () => {
    it("is zero for an empty ship", () => {
        expect(shipCost(new Ship("test", "Empty"))).toBe(0)
    })

    it("charges for hull plating", () => {
        // Plating is not free: a bigger hull is a more expensive ship
        expect(shipCost(shipWith())).toBe(3)
    })

    it("charges nothing for a cosmetic block", () => {
        // The same plate that costs 3 on the hull layer costs nothing as
        // decoration: the exemption is about where a block sits, not what it is
        const ship = shipWith()
        const before = shipCost(ship)
        ship.layers.cosmetic.set(5, 5, "full")

        expect(shipCost(ship)).toBe(before)
    })

    it("totals the components", () => {
        // hull-plate 3 + fusion-core 90 + ion-thruster 30
        expect(shipCost(shipWith(["fusion-core", "ion-thruster"]))).toBe(123)
    })

    it("prices a level from its own row, not a multiple of level 1", () => {
        const ship = shipWith(["fusion-core"])
        ship.layers.components.set(0, 0, "full", { type: "fusion-core", level: 2 })

        expect(shipCost(ship)).toBe(223)
    })

    it("splits the total by category", () => {
        const costs = costByKind(shipWith(["fusion-core", "ion-thruster", "battery"]))

        expect(costs.generator).toBe(90)
        expect(costs.thruster).toBe(30)
        expect(costs.cargo).toBe(40)
        expect(costs.hull).toBe(3)
        expect(costs.weapon).toBe(0)
    })
})