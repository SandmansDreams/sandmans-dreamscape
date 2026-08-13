import { describe, expect, it } from "vitest"
import { Ship } from "../../game/ship"
import { canPlaceAt, thrusterFacings } from "./shipLegality"

function shipWithHull(): Ship {
    const ship = new Ship("t", "T")
    // A 3x3 block of hull from (0,0) to (2,2)
    ship.layers.hull.fill(0, 0, 2, 2, "full")
    return ship
}

describe("hull adjacency", () => {
    it("lets the first block go anywhere", () => {
        const ship = new Ship("t", "T")
        expect(canPlaceAt(ship, "hull", 17, -4, "hull").ok).toBe(true)
    })

    it("refuses a block that touches nothing", () => {
        const result = canPlaceAt(shipWithHull(), "hull", 5, 5, "hull")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("touch")
    })

    it("allows a block against an existing one", () => {
        expect(canPlaceAt(shipWithHull(), "hull", 3, 1, "hull").ok).toBe(true)
    })

    it("allows repainting a block that is already there", () => {
        // A lone starter block has no neighbors, so a naive adjacency check would
        // refuse to recolor the only block on the ship
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full")
        expect(canPlaceAt(ship, "hull", 0, 0, "hull").ok).toBe(true)
    })
})

describe("layer rules", () => {
    it("refuses a weapon on the hull layer", () => {
        const result = canPlaceAt(shipWithHull(), "hull", 1, 1, "weapon")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("cannot go on")
    })

    it("refuses a component floating beside the hull", () => {
        const result = canPlaceAt(shipWithHull(), "placement", 9, 9, "weapon")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("sit on")
    })

    it("allows a component on top of a hull block", () => {
        expect(canPlaceAt(shipWithHull(), "placement", 1, 1, "weapon").ok).toBe(true)
    })
})

describe("thruster edge rule", () => {
    it("allows one within reach of any edge", () => {
        // (1,2) is the bottom row of a 3x3 hull, so south is open one step away
        expect(canPlaceAt(shipWithHull(), "coverable", 1, 2, "thruster").ok).toBe(true)
    })

    it("refuses one buried too deep", () => {
        const ship = new Ship("t", "T")
        // 7x7, so the middle cell is three steps from every edge - no direction
        // reaches open space within the reach
        ship.layers.hull.fill(0, 0, 6, 6, "full")

        const result = canPlaceAt(ship, "coverable", 3, 3, "thruster")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("edge")
    })

    it("reports every direction that reaches an edge", () => {
        // Bottom middle of a 3x3: south is open, and east and west are one step
        // out too. North is the only way blocked within reach.
        expect(thrusterFacings(shipWithHull(), 1, 2).sort()).toEqual([1, 2, 3])
    })

    it("does not apply the rule to other kinds", () => {
        // A generator may sit anywhere on the hull, however deep
        const ship = new Ship("t", "T")
        ship.layers.hull.fill(0, 0, 2, 5, "full")
        expect(canPlaceAt(ship, "coverable", 1, 0, "generator").ok).toBe(true)
    })
})