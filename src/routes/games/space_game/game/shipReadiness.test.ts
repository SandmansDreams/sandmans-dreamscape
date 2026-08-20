import { describe, expect, it } from "vitest"
import { Ship } from "./ship"
import { countKinds, isReady, issuesFor } from "./shipReadiness"

/** A hull block, plus whatever components the test asks for. */
function shipWith(types: string[] = [], name = "Test Ship"): Ship {
    const ship = new Ship("test", name)
    ship.layers.hull.set(0, 0, "full")

    types.forEach((type, index) => {
        ship.layers.components.set(index, 0, "full", { type })
    })

    return ship
}

function ids(ship: Ship, name?: string): string[] {
    return issuesFor(ship, name).map((issue) => issue.id)
}

describe("counting", () => {
    it("counts across every layer, not just one", () => {
        const ship = shipWith(["ion-thruster"])
        ship.layers.cosmetic.set(5, 5, "full")

        const counts = countKinds(ship)
        expect(counts.thruster).toBe(1)
        // The hull block and the cosmetic one, which is a hull type too
        expect(counts.hull).toBe(2)
    })

    it("reports zero for a category the ship has none of", () => {
        expect(countKinds(shipWith()).weapon).toBe(0)
    })
})

describe("readiness", () => {
    it("passes a ship with a thruster and a generator", () => {
        const ship = shipWith(["ion-thruster", "fusion-core"])

        expect(issuesFor(ship)).toEqual([])
        expect(isReady(ship)).toBe(true)
    })

    it("says only that an empty ship is empty", () => {
        // Listing every missing part on a blank grid is noise: there is one thing
        // wrong with it and it is not the thrusters
        expect(ids(new Ship("blank", "Blank"))).toEqual(["empty"])
    })

    it("wants a thruster", () => {
        expect(ids(shipWith(["fusion-core"]))).toEqual(["no-thruster"])
    })

    it("wants a generator", () => {
        expect(ids(shipWith(["ion-thruster"]))).toEqual(["no-generator"])
    })

    it("reports everything wrong at once rather than one at a time", () => {
        expect(ids(shipWith())).toEqual(["no-thruster", "no-generator"])
    })

    it("blames the thrusters for the missing generator only when there are some", () => {
        const powerless = issuesFor(shipWith(["ion-thruster"]))[0]!
        const empty = issuesFor(shipWith())[1]!

        expect(powerless.message).toContain("thrusters")
        expect(empty.message).not.toContain("thrusters")
    })

    it("wants a name that is more than spaces", () => {
        const ship = shipWith(["ion-thruster", "fusion-core"])

        expect(ids(ship, "   ")).toEqual(["unnamed"])
        expect(ids(ship, "Kestrel")).toEqual([])
    })

    it("checks the name it is given rather than the one on the ship", () => {
        // The download dialog edits a name before it is committed, and it is that
        // pending name the rules have to judge
        const ship = shipWith(["ion-thruster", "fusion-core"], "")

        expect(ids(ship)).toEqual(["unnamed"])
        expect(ids(ship, "Renamed")).toEqual([])
    })
})
