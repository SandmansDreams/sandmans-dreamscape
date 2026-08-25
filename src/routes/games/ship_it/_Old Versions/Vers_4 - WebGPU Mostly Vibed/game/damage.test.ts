import { describe, expect, it } from "vitest"
import { DISABLED_AT, effectiveness, IMPAIRED_AT, maxHitPointsOf, ShipDamage } from "./damage"
import { Ship } from "./ship"

function shipWith(type = "ion-thruster"): Ship {
    const ship = new Ship("t", "T")
    ship.layers.hull.set(0, 0, "full")
    ship.layers.components.set(0, 0, "full", { type })

    return ship
}

const cellOf = (ship: Ship) => ship.layers.components.get(0, 0)!

describe("effectiveness", () => {
    it("is untouched right up to the first threshold", () => {
        expect(effectiveness(0)).toBe(1)
        expect(effectiveness(IMPAIRED_AT)).toBe(1)
    })

    it("is gone from the second threshold on", () => {
        expect(effectiveness(DISABLED_AT)).toBe(0)
        expect(effectiveness(1)).toBe(0)
    })

    it("fades between them rather than switching", () => {
        // A part that worked perfectly until it did not would make damage
        // invisible right up to the moment it mattered
        const half = effectiveness((IMPAIRED_AT + DISABLED_AT) / 2)

        expect(half).toBeCloseTo(0.5)
        expect(effectiveness(0.3)).toBeGreaterThan(effectiveness(0.6))
    })
})

describe("taking damage", () => {
    it("leaves an untouched block whole", () => {
        const ship = shipWith()
        const damage = new ShipDamage()

        expect(damage.fractionAt("components", cellOf(ship))).toBe(0)
        expect(damage.effectivenessAt("components", cellOf(ship))).toBe(1)
    })

    it("accumulates across hits", () => {
        const ship = shipWith()
        const damage = new ShipDamage()
        const most = maxHitPointsOf(cellOf(ship))

        damage.hit(ship, "components", 0, 0, most * 0.2)
        damage.hit(ship, "components", 0, 0, most * 0.2)

        expect(damage.fractionAt("components", cellOf(ship))).toBeCloseTo(0.4)
    })

    it("takes a block off the ship when it runs out", () => {
        // A plate with nothing left is a hole, and a hole is something shots pass
        // through rather than a block sitting at zero
        const ship = shipWith()
        const damage = new ShipDamage()

        expect(damage.hit(ship, "components", 0, 0, maxHitPointsOf(cellOf(ship)))).toBe("destroyed")
        expect(ship.layers.components.get(0, 0)).toBeUndefined()
    })

    it("reports a miss on empty space", () => {
        expect(new ShipDamage().hit(shipWith(), "components", 9, 9, 5)).toBe("missed")
    })

    it("ignores a hit for nothing", () => {
        const ship = shipWith()
        const damage = new ShipDamage()

        expect(damage.hit(ship, "components", 0, 0, 0)).toBe("missed")
        expect(damage.count).toBe(0)
    })

    it("does not confuse two layers at the same place", () => {
        const ship = shipWith()
        const damage = new ShipDamage()

        damage.hit(ship, "components", 0, 0, 3)

        expect(damage.fractionAt("hull", ship.layers.hull.get(0, 0)!)).toBe(0)
        expect(damage.fractionAt("components", cellOf(ship))).toBeGreaterThan(0)
    })

    it("forgets a block it destroyed rather than holding its damage", () => {
        const ship = shipWith()
        const damage = new ShipDamage()

        damage.hit(ship, "components", 0, 0, maxHitPointsOf(cellOf(ship)))
        expect(damage.count).toBe(0)
    })
})

describe("what a block started with", () => {
    it("respects a block built tougher than stock", () => {
        // A file may override hp, and a tougher block should take more to break
        const ship = shipWith()
        ship.layers.components.set(0, 0, "full", { type: "ion-thruster", hitPoints: 999 })

        expect(maxHitPointsOf(cellOf(ship))).toBe(999)
    })
})

describe("listing what is hurt", () => {
    it("visits only the damaged blocks", () => {
        const ship = shipWith()
        const damage = new ShipDamage()
        damage.hit(ship, "components", 0, 0, 2)

        const seen: string[] = []
        damage.forEach(ship, (layer, cell) => seen.push(`${layer}:${cell.col},${cell.row}`))

        expect(seen).toEqual(["components:0,0"])
    })

    it("visits nothing on an unscratched ship", () => {
        const seen: string[] = []
        new ShipDamage().forEach(shipWith(), () => seen.push("x"))

        expect(seen).toEqual([])
    })
})
