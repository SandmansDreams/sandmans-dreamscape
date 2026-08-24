import { describe, expect, it } from "vitest"
import { shipPhysics, DRY } from "./physics"
import { Ship } from "./ship"
import {
    BROWNOUT, fullReserves, shipSystems, tickSystems,
    type Reserves, type ShipSystems, type ThrusterLoad,
} from "./shipSystems"

const DT = 1 / 60

function plant(
    islands: { output: number; capacity: number; burn: number }[],
    thrusters: ThrusterLoad[],
    fuelCapacity = 1000,
): ShipSystems {
    return { islands, thrusters, fuelCapacity }
}

/** One island with plenty of everything, and engines that all reach it. */
function easy(thrusters: ThrusterLoad[]): ShipSystems {
    return plant([{ output: 1000, capacity: 1000, burn: 1 }], thrusters)
}

describe("the network's teeth", () => {
    it("gates an engine on no island to exactly zero", () => {
        const systems = easy([{ island: 0, draw: 3 }, { island: -1, draw: 3 }])
        const tick = tickSystems(systems, fullReserves(systems), [1, 1], DT)

        expect(tick.firing[0]).toBe(1)
        expect(tick.firing[1]).toBe(0)
    })

    it("does not let an unreachable engine spend anything", () => {
        const systems = easy([{ island: -1, draw: 100 }])
        const tick = tickSystems(systems, fullReserves(systems), [1], DT)

        expect(tick.drawing).toBe(0)
    })
})

describe("brownout", () => {
    it("scales every engine on an island by the same factor", () => {
        // Demand 30/s against an empty store fed by 15/s: half of what is asked
        const systems = plant(
            [{ output: 15, capacity: 0, burn: 1 }],
            [{ island: 0, draw: 10 }, { island: 0, draw: 20 }],
        )
        const tick = tickSystems(systems, { fuel: 1000, power: [0] }, [1, 1], DT)

        expect(tick.firing[0]).toBeCloseTo(0.5)
        expect(tick.firing[1]).toBeCloseTo(0.5)
        // The ratio is the guarantee: it is what keeps the thrust vector pointing
        // where the pilot aimed it while the ship strains
        expect(tick.firing[0]! / tick.firing[1]!).toBeCloseTo(1)
    })

    it("leaves a ship that can pay entirely alone", () => {
        const systems = easy([{ island: 0, draw: 3 }, { island: 0, draw: 5 }])
        const tick = tickSystems(systems, fullReserves(systems), [1, 0.4], DT)

        expect(tick.firing).toEqual([1, 0.4])
    })

    it("keeps two islands independent", () => {
        const systems = plant(
            [{ output: 0, capacity: 0, burn: 0 }, { output: 100, capacity: 100, burn: 1 }],
            [{ island: 0, draw: 10 }, { island: 1, draw: 10 }],
        )
        const tick = tickSystems(systems, { fuel: 1000, power: [0, 100] }, [1, 1], DT)

        expect(tick.firing[0]).toBe(0)
        expect(tick.firing[1]).toBe(1)
    })
})

describe("fuel", () => {
    it("burns nothing once the stores are full and nothing is asking", () => {
        const systems = easy([{ island: 0, draw: 3 }])
        const tick = tickSystems(systems, fullReserves(systems), [0], DT)

        expect(tick.reserves.fuel).toBe(systems.fuelCapacity)
        expect(tick.producing).toBe(0)
    })

    it("burns in proportion to what it actually produced", () => {
        // Asked for a tenth of the rating, so a tenth of the fuel
        const systems = plant([{ output: 100, capacity: 0, burn: 1 }], [{ island: 0, draw: 10 }])
        const tick = tickSystems(systems, { fuel: 500, power: [0] }, [1], DT)

        expect(500 - tick.reserves.fuel).toBeCloseTo(0.1 * DT)
    })

    it("stops producing when the tanks run dry", () => {
        const systems = plant([{ output: 100, capacity: 0, burn: 1 }], [{ island: 0, draw: 100 }])
        const tick = tickSystems(systems, { fuel: 0, power: [0] }, [1], DT)

        expect(tick.producing).toBe(0)
        expect(tick.firing[0]).toBe(0)
        expect(tick.reserves.fuel).toBe(0)
    })
})

describe("reserves stay sane", () => {
    it("never goes negative or past capacity over a long run", () => {
        const systems = plant(
            [{ output: 8, capacity: 40, burn: 0.6 }],
            [{ island: 0, draw: 12 }],
        )
        let reserves: Reserves = fullReserves(systems)

        for (let frame = 0; frame < 5000; frame++) {
            // Alternating hard burn and coast, so it drains and refills repeatedly
            const throttle = frame % 200 < 120 ? 1 : 0
            reserves = tickSystems(systems, reserves, [throttle], DT).reserves

            expect(reserves.power[0]!).toBeGreaterThanOrEqual(0)
            expect(reserves.power[0]!).toBeLessThanOrEqual(40)
            expect(reserves.fuel).toBeGreaterThanOrEqual(0)
        }
    })
})

describe("emission gain", () => {
    const systems = easy([])

    function gainAt(stored: number): number {
        return tickSystems(plant([{ output: 0, capacity: 100, burn: 0 }], []),
            { fuel: 0, power: [stored] }, [], DT).emissionGain
    }

    it("is full above the brownout threshold", () => {
        expect(gainAt(100)).toBe(1)
        expect(gainAt(BROWNOUT * 100 + 1)).toBe(1)
    })

    it("is dark on an empty store", () => {
        expect(gainAt(0)).toBe(0)
    })

    it("fades rather than snapping between them", () => {
        expect(gainAt(BROWNOUT * 100 / 2)).toBeCloseTo(0.5)
    })

    it("is dark on a ship with no generator at all", () => {
        expect(tickSystems(plant([], [{ island: -1, draw: 3 }]),
            { fuel: 0, power: [] }, [1], DT).emissionGain).toBe(0)
        expect(systems.islands).toHaveLength(1) // sanity: `easy` really has one
    })
})

describe("wiring to a ship", () => {
    it("matches each engine to the island under it", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full")
        ship.layers.components.set(0, 0, "full", { type: "fusion-core" })
        // Inside the core's reach of 6, and far outside it
        ship.layers.components.set(3, 0, "full", { type: "ion-thruster", facing: 2 })
        ship.layers.components.set(40, 0, "full", { type: "ion-thruster", facing: 2 })

        const physics = shipPhysics(ship, DRY)
        const systems = shipSystems(ship, physics)

        const near = physics.thrusters.findIndex((t) => t.col === 3)
        const far = physics.thrusters.findIndex((t) => t.col === 40)

        expect(systems.thrusters[near]!.island).toBe(0)
        expect(systems.thrusters[far]!.island).toBe(-1)
        expect(systems.thrusters[near]!.draw).toBe(3)
    })

    it("totals the tanks", () => {
        const ship = new Ship("t", "T")
        ship.layers.components.set(0, 0, "full", { type: "fuel-tank" })
        ship.layers.components.set(1, 0, "full", { type: "fuel-tank", level: 2 })

        expect(shipSystems(ship, shipPhysics(ship, DRY)).fuelCapacity).toBe(420)
    })
})
describe("one-off requests", () => {
    it("grants a shot the island can pay for", () => {
        const systems = easy([])
        const tick = tickSystems(systems, fullReserves(systems), [], DT, [{ island: 0, amount: 12 }])

        expect(tick.granted).toEqual([true])
    })

    it("refuses one it cannot, rather than half-paying it", () => {
        // Half a shot is not a dimmer shot - it is a weapon that did not fire
        const systems = plant([{ output: 0, capacity: 5, burn: 0 }], [])
        const tick = tickSystems(systems, { fuel: 0, power: [5] }, [], DT, [{ island: 0, amount: 12 }])

        expect(tick.granted).toEqual([false])
        expect(tick.reserves.power[0]).toBe(5)
    })

    it("refuses a weapon no generator reaches", () => {
        const systems = easy([])
        const tick = tickSystems(systems, fullReserves(systems), [], DT, [{ island: -1, amount: 1 }])

        expect(tick.granted).toEqual([false])
    })

    it("will not grant two shots the island can only pay for once", () => {
        const systems = plant([{ output: 0, capacity: 20, burn: 0 }], [])
        const tick = tickSystems(systems, { fuel: 0, power: [20] }, [], DT, [
            { island: 0, amount: 12 },
            { island: 0, amount: 12 },
        ])

        expect(tick.granted).toEqual([true, false])
    })

    it("pays the shot before the thrust it is competing with", () => {
        // Thrust is the only load that degrades gracefully, so it absorbs the
        // shortfall rather than the trigger doing it
        const systems = plant(
            [{ output: 0, capacity: 20, burn: 0 }],
            [{ island: 0, draw: 600 }],
        )
        const tick = tickSystems(systems, { fuel: 0, power: [20] }, [1], DT, [
            { island: 0, amount: 12 },
        ])

        expect(tick.granted).toEqual([true])
        expect(tick.firing[0]).toBeLessThan(1)
    })
})
