import { describe, expect, it } from "vitest"
import { Ship } from "../../game/ship"
import { canPlaceAt } from "./shipLegality"

function shipWithHull(): Ship {
    const ship = new Ship("t", "T")
    // A 3x3 block of hull from (0,0) to (2,2)
    ship.layers.hull.fill(0, 0, 2, 2, "full")
    return ship
}

describe("hull adjacency", () => {
    it("lets the first block go anywhere", () => {
        const ship = new Ship("t", "T")
        expect(canPlaceAt(ship, "hull", 17, -4, "hull", 0).ok).toBe(true)
    })

    it("refuses a block that touches nothing", () => {
        const result = canPlaceAt(shipWithHull(), "hull", 5, 5, "hull", 0)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("touch")
    })

    it("allows a block against an existing one", () => {
        expect(canPlaceAt(shipWithHull(), "hull", 3, 1, "hull", 0).ok).toBe(true)
    })

    it("allows repainting a block that is already there", () => {
        // A lone starter block has no neighbors, so a naive adjacency check would
        // refuse to recolor the only block on the ship
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full")
        expect(canPlaceAt(ship, "hull", 0, 0, "hull", 0).ok).toBe(true)
    })
})

describe("layer rules", () => {
    it("refuses a weapon on the hull layer", () => {
        const result = canPlaceAt(shipWithHull(), "hull", 1, 1, "weapon", 0)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("cannot go on")
    })

    it("refuses a component floating beside the hull", () => {
        const result = canPlaceAt(shipWithHull(), "placement", 9, 9, "weapon", 0)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("sit on")
    })

    it("allows a component on top of a hull block", () => {
        expect(canPlaceAt(shipWithHull(), "placement", 1, 1, "weapon", 0).ok).toBe(true)
    })
})

describe("thruster edge rule", () => {
    it("allows one at the edge facing out", () => {
        // (1,2) is the bottom row of a 3x3 hull; facing 2 is south, straight out
        expect(canPlaceAt(shipWithHull(), "coverable", 1, 2, "thruster", 2).ok).toBe(true)
    })

    it("refuses one buried too deep", () => {
        const ship = new Ship("t", "T")
        // Six rows tall, so (1,0) facing south has hull for well past two steps
        ship.layers.hull.fill(0, 0, 2, 5, "full")

        const result = canPlaceAt(ship, "coverable", 1, 0, "thruster", 2)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("edge")
    })

    it("refuses one at the edge facing inward", () => {
        // Bottom row, but pointing north into the ship
        expect(canPlaceAt(shipWithHull(), "coverable", 1, 2, "thruster", 0).ok).toBe(false)
    })

    it("does not apply the rule to other kinds", () => {
        // A generator may sit anywhere on the hull, however deep
        const ship = new Ship("t", "T")
        ship.layers.hull.fill(0, 0, 2, 5, "full")
        expect(canPlaceAt(ship, "coverable", 1, 0, "generator", 0).ok).toBe(true)
    })
})