import { describe, expect, it } from "vitest"
import { Ship } from "../../game/ship"
import { canClearLayer, canEraseAt, canPlaceAt, thrusterFacings } from "./shipLegality"

function shipWithHull(): Ship {
    const ship = new Ship("t", "T")
    // A 3x3 block of hull from (0,0) to (2,2)
    ship.layers.hull.fill(0, 0, 2, 2, "full")
    return ship
}

describe("hull adjacency", () => {
    it("lets the first block go anywhere", () => {
        const ship = new Ship("t", "T")
        expect(canPlaceAt(ship, "hull", 17, -4, "hull-plate").ok).toBe(true)
    })

    it("refuses a block that touches nothing", () => {
        const result = canPlaceAt(shipWithHull(), "hull", 5, 5, "hull-plate")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("touch")
    })

    it("allows a block against an existing one", () => {
        expect(canPlaceAt(shipWithHull(), "hull", 3, 1, "hull-plate").ok).toBe(true)
    })

    it("allows repainting a block that is already there", () => {
        // A lone starter block has no neighbors, so a naive adjacency check would
        // refuse to recolor the only block on the ship
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full")
        expect(canPlaceAt(ship, "hull", 0, 0, "hull-plate").ok).toBe(true)
    })
})

describe("layer rules", () => {
    it("refuses a weapon on the hull layer", () => {
        const result = canPlaceAt(shipWithHull(), "hull", 1, 1, "autocannon")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("cannot go on")
    })

    it("refuses a component floating beside the hull", () => {
        const result = canPlaceAt(shipWithHull(), "components", 9, 9, "autocannon")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("sit on")
    })

    it("allows a component on top of a hull block", () => {
        expect(canPlaceAt(shipWithHull(), "components", 1, 1, "autocannon").ok).toBe(true)
    })
})

describe("thruster edge rule", () => {
    it("allows one within reach of any edge", () => {
        // (1,2) is the bottom row of a 3x3 hull, so south is open one step away
        expect(canPlaceAt(shipWithHull(), "components", 1, 2, "ion-thruster").ok).toBe(true)
    })

    it("refuses one buried too deep", () => {
        const ship = new Ship("t", "T")
        // 7x7, so the middle cell is three steps from every edge - no direction
        // reaches open space within the reach
        ship.layers.hull.fill(0, 0, 6, 6, "full")

        const result = canPlaceAt(ship, "components", 3, 3, "ion-thruster")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("edge")
    })

    it("reports every direction that reaches an edge", () => {
        // Bottom middle of a 3x3: south is open, and east and west are one step
        // out too. North is the only way blocked within reach.
        expect(thrusterFacings(shipWithHull(), 1, 2).sort()).toEqual([1, 2, 3])
    })

    it("does not apply the rule to other categories", () => {
        // A generator may sit anywhere on the hull, however deep
        const ship = new Ship("t", "T")
        ship.layers.hull.fill(0, 0, 2, 5, "full")
        expect(canPlaceAt(ship, "components", 1, 0, "fusion-core").ok).toBe(true)
    })
})

describe("canEraseAt", () => {
    /** A 1x3 bridge: erasing the middle is the classic split. */
    function bridge(): Ship {
        const ship = new Ship("t", "T")
        ship.layers.hull.fill(0, 0, 2, 0, "full")
        return ship
    }

    it("refuses an erase that would cut the ship in two", () => {
        const result = canEraseAt(bridge(), "hull", 1, 0)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("floating")
    })

    it("allows erasing an end", () => {
        expect(canEraseAt(bridge(), "hull", 0, 0).ok).toBe(true)
        expect(canEraseAt(bridge(), "hull", 2, 0).ok).toBe(true)
    })

    it("allows erasing the middle of a loop, which stays connected", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.fill(0, 0, 2, 2, "full")

        expect(canEraseAt(ship, "hull", 1, 0).ok).toBe(true)
    })

    it("refuses erasing hull that carries something", () => {
        const ship = bridge()
        ship.layers.components.set(0, 0, "full", { type: "ion-thruster" })

        const result = canEraseAt(ship, "hull", 0, 0)
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("components")
    })

    it("allows erasing the last hull block", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full")

        expect(canEraseAt(ship, "hull", 0, 0).ok).toBe(true)
    })

    it("leaves other layers alone", () => {
        const ship = bridge()
        ship.layers.components.set(1, 0, "full", { type: "autocannon" })

        expect(canEraseAt(ship, "components", 1, 0).ok).toBe(true)
    })

    it("treats erasing empty space as legal", () => {
        expect(canEraseAt(bridge(), "hull", 9, 9).ok).toBe(true)
    })
})

describe("canClearLayer", () => {
    it("refuses clearing hull with anything on top", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.fill(0, 0, 2, 0, "full")
        ship.layers.components.set(1, 0, "full", { type: "crate" })

        const result = canClearLayer(ship, "hull")
        expect(result.ok).toBe(false)
        expect(result.reason).toContain("1 block")
    })

    it("allows clearing a bare hull", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.fill(0, 0, 2, 0, "full")

        expect(canClearLayer(ship, "hull").ok).toBe(true)
    })

    it("never blocks clearing a layer nothing rides on", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full")
        ship.layers.components.set(0, 0, "full", { type: "crate" })

        expect(canClearLayer(ship, "components").ok).toBe(true)
        expect(canClearLayer(ship, "cosmetic").ok).toBe(true)
    })
})