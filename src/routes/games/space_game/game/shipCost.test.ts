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

    it("charges nothing for hull", () => {
        expect(shipCost(shipWith())).toBe(0)
    })

    it("charges nothing for a cosmetic block", () => {
        const ship = shipWith()
        ship.layers.cosmetic.set(5, 5, "full")

        expect(shipCost(ship)).toBe(0)
    })

    it("totals the components", () => {
        // fusion-core 90 + ion-thruster 30
        expect(shipCost(shipWith(["fusion-core", "ion-thruster"]))).toBe(120)
    })

    it("prices a level from its own row, not a multiple of level 1", () => {
        const ship = shipWith(["fusion-core"])
        ship.layers.components.set(0, 0, "full", { type: "fusion-core", level: 2 })

        expect(shipCost(ship)).toBe(220)
    })

    it("splits the total by category", () => {
        const costs = costByKind(shipWith(["fusion-core", "ion-thruster", "battery"]))

        expect(costs.generator).toBe(90)
        expect(costs.thruster).toBe(30)
        expect(costs.cargo).toBe(40)
        expect(costs.hull).toBe(0)
        expect(costs.weapon).toBe(0)
    })
})