// What a ship's plant makes, holds and spends in one frame

import { componentById, TankComponent } from "../render/grid/components"
import { loadStage, type ShipPhysics } from "./physics"
import { islandAt, powerNetworkOf, type PowerIsland } from "./powerNetwork"
import type { Ship } from "./ship"

/**
 * The fraction of capacity below which the lights start to go.
 *
 * Not zero, so a ship browns out visibly on its way down rather than snapping
 * dark on the last unit spent.
 */
export const BROWNOUT = 0.15

/** One power-consuming engine, tied to the island that feeds it. */
export interface ThrusterLoad {
    /** Island index, or -1 for an engine no generator reaches. */
    island: number
    /** Power per second at full throttle. */
    draw: number
}

/**
 * A ship's plant, resolved against its physics.
 *
 * `thrusters` is indexed exactly like `ShipPhysics.thrusters`, which is the whole
 * reason a Thruster carries its grid position: an engine has to be matched to the
 * island underneath it, and `offset` cannot answer that - it is measured from a
 * centre of mass that moves as the tanks drain.
 */
export interface ShipSystems {
    islands: readonly PowerIsland[]
    thrusters: readonly ThrusterLoad[]
    /** Fuel the tanks hold when full, ship-wide. */
    fuelCapacity: number
}

/**
 * What is actually aboard right now.
 *
 * Fuel is one number for the whole ship: plumbing is assumed, and a second
 * spatial puzzle would double the rules a player has to hold without doubling
 * what is interesting about them. Power is per island, because keeping those
 * apart is exactly what the network is for.
 */
export interface Reserves {
    fuel: number
    /** Indexed like ShipSystems.islands. */
    power: readonly number[]
}

/**
 * A one-off draw asked for this frame, such as a weapon wanting to fire.
 *
 * Separate from the continuous loads because it is all-or-nothing: half a shot
 * is not a dimmer shot, it is a weapon that did not fire. Thrust is the only
 * load that degrades gracefully, which is why it is paid last.
 */
export interface PowerRequest {
    /** Island index, or -1 for a part nothing reaches. */
    island: number
    amount: number
}

export interface SystemsTick {
    reserves: Reserves
    /** Throttles after gating: what step, the exhaust and the glow all read. */
    firing: number[]
    /** 0..1, how brightly emissive cells burn. Zero is a dead ship. */
    emissionGain: number
    /** Power per second made and spent this frame, for the readout. */
    producing: number
    drawing: number
    /** Which one-off requests were paid, in the order they were asked. */
    granted: boolean[]
}

export function shipSystems(ship: Ship, physics: ShipPhysics): ShipSystems {
    const network = powerNetworkOf(ship)

    const thrusters = physics.thrusters.map((thruster) => ({
        island: islandAt(network, thruster.col, thruster.row),
        draw: thruster.draw,
    }))

    let fuelCapacity = 0
    for (const grid of ship.layersOf()) {
        for (const cell of grid.list) {
            const component = componentById(cell.type)
            if (component instanceof TankComponent) {
                fuelCapacity += component.statsAt(cell.level).capacity
            }
        }
    }

    return { islands: network.islands, thrusters, fuelCapacity }
}

/** Full tanks and charged batteries - what a ship arrives for a test flight with. */
export function fullReserves(systems: ShipSystems): Reserves {
    return {
        fuel: systems.fuelCapacity,
        power: systems.islands.map((island) => island.capacity),
    }
}

/** Where the fuel sits on the mass staircase, for the physics cache. */
export function fuelStage(systems: ShipSystems, reserves: Reserves): number {
    return loadStage(reserves.fuel, systems.fuelCapacity)
}

/**
 * One frame of the plant: make power, spend it, and scale back what could not
 * be paid for.
 *
 * Returns new reserves rather than mutating them, matching step()'s precedent -
 * the scene assigns the result the same way it assigns its body.
 */
export function tickSystems(
    systems: ShipSystems,
    reserves: Reserves,
    wanted: readonly number[],
    dt: number,
    requests: readonly PowerRequest[] = [],
): SystemsTick {
    const power = systems.islands.map((_, index) => reserves.power[index] ?? 0)
    const firing = systems.thrusters.map((_, index) => wanted[index] ?? 0)

    if (dt <= 0) {
        return {
            reserves: { fuel: reserves.fuel, power },
            firing,
            emissionGain: emissionGainOf(systems, power),
            producing: 0,
            drawing: 0,
            granted: requests.map(() => false),
        }
    }

    // What each island is asked for - and what an engine on no island gets, which
    // is nothing. That is the network's teeth: a badly placed engine is dead
    // weight rather than a free one.
    const demand = systems.islands.map(() => 0)
    systems.thrusters.forEach((thruster, index) => {
        if (thruster.island < 0) {
            firing[index] = 0
            return
        }

        demand[thruster.island]! += thruster.draw * firing[index]!
    })

    // Generators follow demand and put whatever rating is left over into the
    // stores, so a battery refills while coasting and a plant with nothing to do
    // settles to burning nothing at all once everything is full
    const rates = systems.islands.map((island, index) => {
        const room = (island.capacity - power[index]!) / dt
        return Math.min(island.output, Math.max(demand[index]! + room, 0))
    })

    // Fuel is one pool, so a shortfall is shared out before anything is produced -
    // otherwise whichever island came first in the array would drink all of it
    let burn = 0
    systems.islands.forEach((island, index) => {
        if (island.output <= 0) return
        burn += island.burn * (rates[index]! / island.output)
    })

    const affordable = burn * dt <= reserves.fuel ? 1 : burn > 0 ? reserves.fuel / (burn * dt) : 1

    // Spend, and scale an island's engines back uniformly when it cannot pay.
    // Uniform rather than cutting engines one at a time: dropping individual
    // engines would swing the thrust vector off where the pilot aimed it, which
    // is a far worse failure than simply accelerating more gently.
    let producing = 0
    let drawing = 0

    // Spent from what is stored *plus* what was just made, because a generator
    // feeds a load directly and only the surplus has to find room in a battery.
    // Storing first and spending second would strand this frame's output on any
    // island whose batteries were already full.
    const available = systems.islands.map((_, index) => {
        const rate = rates[index]! * affordable
        producing += rate

        return power[index]! + rate * dt
    })

    // One-off draws first: a shot is all-or-nothing, so it is paid before the one
    // load that can be scaled back instead of refused. Asked in order, so two
    // weapons on one island cannot both be granted the last of the charge.
    const granted = requests.map((request) => {
        if (request.island < 0 || request.amount <= 0) return request.amount <= 0
        if (available[request.island]! < request.amount) return false

        available[request.island]! -= request.amount
        drawing += request.amount / dt

        return true
    })

    const scale = systems.islands.map((island, index) => {
        const need = demand[index]! * dt
        const paid = Math.min(need, available[index]!)

        power[index] = Math.min(island.capacity, available[index]! - paid)
        drawing += paid / dt

        return need > 0 ? paid / need : 1
    })

    systems.thrusters.forEach((thruster, index) => {
        if (thruster.island < 0) return
        firing[index] = firing[index]! * scale[thruster.island]!
    })

    return {
        reserves: { fuel: Math.max(0, reserves.fuel - burn * affordable * dt), power },
        firing,
        emissionGain: emissionGainOf(systems, power),
        producing,
        drawing,
        granted,
    }
}

/**
 * How brightly the hull's emissive cells burn, 0..1.
 *
 * A curve rather than a switch: full brightness until the reserves drop under
 * BROWNOUT of capacity, then fading to black as the last of it goes, so losing
 * power reads as a ship dying instead of a light being switched off. A ship with
 * no generator has no capacity at all and comes out 0, which is a free and honest
 * signal that nothing aboard is wired up.
 *
 * Ship-wide rather than per island, because emission is per *cell* in the mesh
 * and a per-island gain would mean a rebuild or another buffer. The running
 * lights are one circuit - a simplification, and a deliberate one.
 */
function emissionGainOf(systems: ShipSystems, power: readonly number[]): number {
    let stored = 0
    let capacity = 0

    systems.islands.forEach((island, index) => {
        stored += power[index]!
        capacity += island.capacity
    })

    if (capacity <= 0) return 0
    return Math.min(Math.max(stored / (capacity * BROWNOUT), 0), 1)
}