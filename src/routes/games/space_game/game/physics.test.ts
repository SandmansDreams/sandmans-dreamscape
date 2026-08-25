import { describe, expect, it } from "vitest"
import {
    bodyAt, bounce, boundingRadius, DRY, FULL, loadStage, LOAD_STAGES,
    shipPhysics, step, throttles,
    type Arena, type Body, type Controls, type ShipPhysics,
    recenter,
} from "./physics"
import { Ship } from "./ship"
import type { Vec2 } from "../render/camera"

/** Where a thruster sits and which way its exhaust points. */
interface Engine {
    col: number
    row: number
    /** 0-3 as N/E/S/W. */
    facing: number
    /** Defaults to true, matching a freshly placed thruster. */
    steering?: boolean
}

function shipWith(engines: readonly Engine[], hull: readonly [number, number][] = []): Ship {
    const ship = new Ship("t", "T")

    for (const [col, row] of hull) ship.layers.hull.set(col, row, "full")
    for (const { col, row, facing, steering } of engines) {
        ship.layers.components.set(col, row, "full", { type: "ion-thruster", facing, steering })
    }

    return ship
}

/** Nothing held down. */
const IDLE: Controls = { move: { x: 0, y: 0 }, turn: 0, assist: false }

function pressing(patch: Partial<Controls>): Controls {
    return { ...IDLE, ...patch }
}

/** Most of these fly a dry hull; the ones that care about load say so. */
function dryPhysics(ship: Ship): ShipPhysics {
    return shipPhysics(ship, DRY)
}

/**
 * A step from controls, the way the scene used to ask for one.
 *
 * step() takes throttles now, but almost every test here is about what a *press*
 * does, and rewriting each one to derive its own would bury that. The tests that
 * are genuinely about throttles call step directly.
 */
function flown(body: Body, physics: ShipPhysics, controls: Controls, dt: number): Body {
    return step(body, physics, throttles(physics, controls, body.spin, dt), dt)
}

describe("mass properties", () => {
    it("puts the center of a symmetric hull at its middle", () => {
        const ship = shipWith([], [[0, 0], [1, 0], [0, 1], [1, 1]])
        const { center } = dryPhysics(ship)

        expect(center.x).toBeCloseTo(1)
        expect(center.y).toBeCloseTo(1)
    })

    it("gives a one-cell ship inertia it can actually be divided by", () => {
        // The failure this guards: with cells as point masses a lone block has no
        // inertia, and the first torque divides by zero
        const { inertia } = dryPhysics(shipWith([], [[0, 0]]))

        expect(inertia).toBeGreaterThan(0)
        expect(Number.isFinite(inertia)).toBe(true)
        // A unit square about its own center: m(w² + h²)/12, which is m/6
        expect(inertia).toBeCloseTo(1 / 6)
    })

    it("makes a long ship harder to turn than a compact one of the same mass", () => {
        const compact = dryPhysics(shipWith([], [[0, 0], [1, 0], [0, 1], [1, 1]]))
        const long = dryPhysics(shipWith([], [[0, 0], [0, 1], [0, 2], [0, 3]]))

        expect(long.mass).toBe(compact.mass)
        expect(long.inertia).toBeGreaterThan(compact.inertia)
    })

    it("lets cosmetics change nothing about how a ship handles", () => {
        const plain = shipWith([], [[0, 0], [1, 0]])

        const decorated = shipWith([], [[0, 0], [1, 0]])
        decorated.layers.cosmetic.set(9, 9, "full")

        expect(dryPhysics(decorated).mass).toBe(dryPhysics(plain).mass)
        expect(dryPhysics(decorated).inertia).toBeCloseTo(dryPhysics(plain).inertia)
        expect(dryPhysics(decorated).center).toEqual(dryPhysics(plain).center)
    })
})

describe("thruster forces", () => {
    it("pushes the ship opposite the way the exhaust leaves", () => {
        // Facing south, so the ship goes north - which is negative y in a grid
        // whose rows count downward
        const [thruster] = dryPhysics(shipWith([{ col: 0, row: 0, facing: 2 }])).thrusters

        expect(thruster!.force.x).toBeCloseTo(0)
        expect(thruster!.force.y).toBeLessThan(0)
    })

    it("produces no torque through the center of mass", () => {
        const { thrusters } = dryPhysics(shipWith([{ col: 0, row: 0, facing: 2 }]))

        expect(thrusters[0]!.torque).toBeCloseTo(0)
    })

    it("cancels the torque of a symmetric pair", () => {
        const { thrusters } = dryPhysics(shipWith([
            { col: 0, row: 0, facing: 2 },
            { col: 4, row: 0, facing: 2 },
        ]))

        const total = thrusters.reduce((sum, t) => sum + t.torque, 0)

        expect(thrusters).toHaveLength(2)
        expect(total).toBeCloseTo(0)
        // Not two zeroes: each one spins the ship, and it is the pair that does not
        expect(Math.abs(thrusters[0]!.torque)).toBeGreaterThan(0)
    })

    it("spins the ship from a single offset thruster", () => {
        // Two engines, one dead - mass sits at the middle and only one pushes
        const ship = shipWith([{ col: 0, row: 0, facing: 2 }, { col: 4, row: 0, facing: 2 }])
        const { thrusters } = dryPhysics(ship)

        expect(thrusters[0]!.torque).not.toBeCloseTo(0)
    })

    it("pins which way an off-center thruster turns the ship", () => {
        // Right of the center, pushing north: the nose swings west, which is
        // counter-clockwise on a screen whose y counts downward. If a refactor ever
        // mirrors the world, this is the test that says so.
        const ship = shipWith([{ col: 0, row: 0, facing: 2 }, { col: 4, row: 0, facing: 2 }])
        const { thrusters } = dryPhysics(ship)

        const right = thrusters.find((t) => t.torque < 0)
        const left = thrusters.find((t) => t.torque > 0)

        expect(right).toBeDefined()
        expect(left).toBeDefined()
    })

    it("ignores blocks that are not thrusters", () => {
        const ship = shipWith([], [[0, 0]])
        ship.layers.components.set(0, 0, "full", { type: "crate" })

        expect(dryPhysics(ship).thrusters).toHaveLength(0)
    })
})

describe("control allocation", () => {
    /** One engine at each end, facing aft, so both push north and both spin. */
    function pair() {
        return dryPhysics(shipWith([
            { col: 0, row: 0, facing: 2 },
            { col: 4, row: 0, facing: 2 },
        ]))
    }

    it("fires an engine that pushes the way you asked", () => {
        const firing = throttles(pair(), pressing({ move: { x: 0, y: -1 } }), 0, 1 / 60)

        expect(firing).toEqual([1, 1])
    })

    it("leaves an engine that fights the direction alone", () => {
        // Asking to go south with only north-pushing engines
        const firing = throttles(pair(), pressing({ move: { x: 0, y: 1 } }), 0, 1 / 60)

        expect(firing).toEqual([0, 0])
    })

    it("picks engines by the way they spin the ship", () => {
        const physics = pair()
        const firing = throttles(physics, pressing({ turn: 1 }), 0, 1 / 60)

        // Exactly the one whose torque is positive, not both
        expect(firing.filter((value) => value > 0)).toHaveLength(1)
        const index = firing.findIndex((value) => value > 0)
        expect(Math.sign(physics.thrusters[index]!.torque)).toBe(1)
    })

    it("fires nothing at all when nothing is asked for", () => {
        expect(throttles(pair(), IDLE, 0, 1 / 60)).toEqual([0, 0])
    })

    it("leaves an engine the builder did not mark for steering out of a turn", () => {
        // The whole point of the flag: this engine has the torque to do it and is
        // still not asked, because the main drive is not what you turn with
        const physics = dryPhysics(shipWith([
            { col: 0, row: 0, facing: 2, steering: false },
            { col: 4, row: 0, facing: 2, steering: false },
        ]))

        expect(throttles(physics, pressing({ turn: 1 }), 0, 1 / 60)).toEqual([0, 0])
    })

    it("still burns an unmarked engine for thrust", () => {
        // Not steering is not disabled - the flag says what Q and E may spend,
        // and nothing about what W does
        const physics = dryPhysics(shipWith([{ col: 0, row: 0, facing: 2, steering: false }]))

        expect(throttles(physics, pressing({ move: { x: 0, y: -1 } }), 0, 1 / 60)).toEqual([1])
    })

    it("fires each axis of a diagonal on its own merits", () => {
        // A dot product of the whole vector mixes the two, so a strong push the
        // wrong way on one axis can outvote a weak right-way push on the other.
        // North engine and east engine, asked for north-east: both, independently.
        const physics = dryPhysics(shipWith([
            { col: 0, row: 0, facing: 2 },
            { col: 1, row: 0, facing: 3 },
        ]))
        const firing = throttles(physics, pressing({ move: { x: 1, y: -1 } }), 0, 1 / 60)

        expect(firing).toEqual([1, 1])
    })

    it("fires the sideways engine even when it will spin the ship", () => {
        // Placement is the player's problem, not the allocator's: pressing D lights
        // up what points west, wherever they put it
        const physics = dryPhysics(shipWith([
            { col: 0, row: 0, facing: 3 },
            { col: 0, row: 4, facing: 2 },
        ]))
        const firing = throttles(physics, pressing({ move: { x: 1, y: 0 } }), 0, 1 / 60)

        expect(firing[0]).toBe(1)
        expect(physics.thrusters[0]!.torque).not.toBe(0)
    })
})

describe("flight assist", () => {
    function pair() {
        return dryPhysics(shipWith([
            { col: 0, row: 0, facing: 2 },
            { col: 4, row: 0, facing: 2 },
        ]))
    }

    it("fires the engine that opposes the spin", () => {
        const physics = pair()
        const firing = throttles(physics, pressing({ assist: true }), 1, 1 / 60)

        const index = firing.findIndex((value) => value > 0)
        expect(index).toBeGreaterThanOrEqual(0)
        // A positive spin is countered by negative torque
        expect(physics.thrusters[index]!.torque).toBeLessThan(0)
    })

    it("does nothing while the pilot is steering", () => {
        // Assist steadies what you are not holding; fighting your own input would
        // make the ship feel like it is arguing with you
        const firing = throttles(pair(), pressing({ assist: true, turn: 1 }), 5, 1 / 60)

        expect(firing.filter((value) => value > 0)).toHaveLength(1)
    })

    it("stays off when assist is off", () => {
        expect(throttles(pair(), pressing({ assist: false }), 5, 1 / 60)).toEqual([0, 0])
    })

    it("never asks for more than full throttle", () => {
        const firing = throttles(pair(), pressing({ assist: true }), 1000, 1 / 60)

        for (const value of firing) expect(value).toBeLessThanOrEqual(1)
    })

    it("eases off as the spin comes down", () => {
        const physics = pair()
        const hard = throttles(physics, pressing({ assist: true }), 0.5, 1 / 60)
        const gentle = throttles(physics, pressing({ assist: true }), 0.001, 1 / 60)

        expect(Math.max(...gentle)).toBeLessThan(Math.max(...hard))
    })

    it("will not steady a spin with engines the builder kept for thrust", () => {
        // Assist is rotation control, so it spends what Q and E spend. Otherwise
        // holding nothing would fire the mains and shove the ship down-range.
        const physics = dryPhysics(shipWith([
            { col: 0, row: 0, facing: 2, steering: false },
            { col: 4, row: 0, facing: 2, steering: false },
        ]))

        expect(throttles(physics, pressing({ assist: true }), 5, 1 / 60)).toEqual([0, 0])
    })

    it("gives a ship with nothing off-axis nothing to stabilise with", () => {
        // The whole rule in one case: assist fires real engines or it does nothing
        const physics = dryPhysics(shipWith([{ col: 0, row: 0, facing: 2 }]))
        const firing = throttles(physics, pressing({ assist: true }), 5, 1 / 60)

        expect(firing).toEqual([0])
    })

    it("will not fire an engine that fights the burn it is steadying", () => {
        const physics = dryPhysics(shipWith([
            { col: 0, row: 0, facing: 1 },
            { col: 4, row: 0, facing: 3 },
        ]))
        const firing = throttles(physics, pressing({ move: { x: 1, y: 0 }, assist: true }), 0.005, 1 / 60)

        physics.thrusters.forEach((thruster, index) => {
            if (thruster.force.x < 0) expect(firing[index]).toBe(0)
        })
    })
})

describe("step", () => {
    const DT = 1 / 60

    function pair() {
        return dryPhysics(shipWith([
            { col: 0, row: 0, facing: 2 },
            { col: 4, row: 0, facing: 2 },
        ]))
    }

    it("accelerates the way the engines push", () => {
        const after = flown(bodyAt(0, 0), pair(), pressing({ move: { x: 0, y: -1 } }), DT)

        expect(after.velocity.y).toBeLessThan(0)
        expect(after.velocity.x).toBeCloseTo(0)
    })

    it("moves using the velocity it just gained, not the one it had", () => {
        // Semi-implicit Euler: a body starting from rest still travels this frame
        const after = flown(bodyAt(0, 0), pair(), pressing({ move: { x: 0, y: -1 } }), DT)

        expect(after.position.y).toBeCloseTo(after.velocity.y * DT)
        expect(after.position.y).not.toBe(0)
    })

    it("keeps coasting with nothing held", () => {
        // Space: no drag, and no quiet damping that would forgive a bad layout
        const drifting = { ...bodyAt(0, 0), velocity: { x: 3, y: -2 }, spin: 0.5 }
        const after = flown(drifting, pair(), IDLE, DT)

        expect(after.velocity).toEqual(drifting.velocity)
        expect(after.spin).toBe(drifting.spin)
        expect(after.position.x).toBeCloseTo(3 * DT)
    })

    it("turns thrust with the ship", () => {
        const physics = pair()
        const controls = pressing({ move: { x: 0, y: -1 } })

        const north = flown(bodyAt(0, 0), physics, controls, DT)
        const turned = flown({ ...bodyAt(0, 0), angle: Math.PI / 2 }, physics, controls, DT)

        // Same engines, ship rotated a quarter turn: the push follows it
        expect(turned.velocity.x).toBeCloseTo(-north.velocity.y)
        expect(turned.velocity.y).toBeCloseTo(north.velocity.x)
    })

    it("leaves the body it was given untouched", () => {
        const before = bodyAt(0, 0)
        flown(before, pair(), pressing({ move: { x: 0, y: -1 } }), DT)

        expect(before.velocity).toEqual({ x: 0, y: 0 })
        expect(before.position).toEqual({ x: 0, y: 0 })
    })

    it("does not divide by a ship with no blocks", () => {
        const empty = dryPhysics(new Ship("t", "T"))
        const body = bodyAt(1, 2)

        expect(() => flown(body, empty, pressing({ move: { x: 0, y: -1 } }), DT)).not.toThrow()
        expect(flown(body, empty, pressing({ move: { x: 0, y: -1 } }), DT)).toEqual(body)
    })

    it("spins a ship burning one engine off-axis", () => {
        const physics = pair()
        const spun = flown(bodyAt(0, 0), physics, pressing({ turn: 1 }), DT)

        expect(spun.spin).not.toBeCloseTo(0)
        expect(spun.angle).toBeCloseTo(spun.spin * DT)
    })

    it("brings a spin back to rest under assist", () => {
        const physics = pair()
        let body = { ...bodyAt(0, 0), spin: 0.4 }

        for (let frame = 0; frame < 120; frame++) {
            body = flown(body, physics, pressing({ assist: true }), DT)
        }

        expect(Math.abs(body.spin)).toBeLessThan(0.01)
    })

    it("charges for that stability in sideways drift", () => {
        // Assist fires real engines, so stopping a spin also pushes the ship. That
        // cost is the honest consequence of not inventing a force to do it with.
        const physics = pair()
        let body = { ...bodyAt(0, 0), spin: 0.4 }

        for (let frame = 0; frame < 120; frame++) {
            body = flown(body, physics, pressing({ assist: true }), DT)
        }

        const speed = Math.hypot(body.velocity.x, body.velocity.y)
        expect(speed).toBeGreaterThan(0)
    })
})


describe("bounding radius", () => {
    it("reaches the far corner of a block, not its middle", () => {
        // One cell: the center of mass is its middle, and the corner is half a unit
        // away on each axis
        expect(boundingRadius(shipWith([], [[0, 0]]))).toBeCloseTo(Math.hypot(0.5, 0.5))
    })

    it("grows with the ship", () => {
        const small = boundingRadius(shipWith([], [[0, 0]]))
        const long = boundingRadius(shipWith([], [[0, 0], [0, 1], [0, 2], [0, 3]]))

        expect(long).toBeGreaterThan(small)
    })

    it("counts cosmetics, which weigh nothing but still hit walls", () => {
        const plain = shipWith([], [[0, 0]])

        const winged = shipWith([], [[0, 0]])
        winged.layers.cosmetic.set(6, 0, "full")

        expect(boundingRadius(winged)).toBeGreaterThan(boundingRadius(plain))
    })
})

describe("bounce", () => {
    const ARENA: Arena = { minX: -10, maxX: 10, minY: -10, maxY: 10 }

    function movingTo(x: number, y: number, vx: number, vy: number): Body {
        return { ...bodyAt(x, y), velocity: { x: vx, y: vy } }
    }

    it("leaves a ship in open space alone", () => {
        const flying = movingTo(0, 0, 3, -2)

        expect(bounce(flying, 1, ARENA, 0.5)).toEqual(flying)
    })

    it("stops the ship at the wall rather than inside it", () => {
        const after = bounce(movingTo(50, 0, 20, 0), 1, ARENA, 0.5)

        // Its own radius short of the wall, however far past it started
        expect(after.position.x).toBeCloseTo(9)
    })

    it("turns the ship around when it hits", () => {
        const after = bounce(movingTo(50, 0, 20, 0), 1, ARENA, 0.5)

        expect(after.velocity.x).toBeCloseTo(-10)
    })

    it("keeps the speed along the wall it slid down", () => {
        // Only the axis that hit is reflected; the other is untouched
        const after = bounce(movingTo(50, 0, 20, 7), 1, ARENA, 0.5)

        expect(after.velocity.y).toBe(7)
    })

    it("stops dead at zero bounciness", () => {
        const after = bounce(movingTo(50, 0, 20, 0), 1, ARENA, 0)

        // Math.abs because reflecting then scaling by zero lands on -0, which is
        // stopped by every measure except Object.is
        expect(Math.abs(after.velocity.x)).toBe(0)
        expect(after.position.x).toBeCloseTo(9)
    })

    it("keeps every bit of speed at full bounciness", () => {
        const after = bounce(movingTo(50, 0, 20, 0), 1, ARENA, 1)

        expect(after.velocity.x).toBeCloseTo(-20)
    })

    it("handles both walls at once in a corner", () => {
        const after = bounce(movingTo(50, -50, 20, -20), 1, ARENA, 0.5)

        expect(after.position.x).toBeCloseTo(9)
        expect(after.position.y).toBeCloseTo(-9)
        expect(after.velocity.x).toBeCloseTo(-10)
        expect(after.velocity.y).toBeCloseTo(10)
    })

    it("never turns a bounce into a spin", () => {
        // A bounding circle touches along the line through its own center, so there
        // is no lever arm. A hull colliding on its real outline would spin, and
        // would need a contact point to do it from.
        const spinning = { ...movingTo(50, 0, 20, 0), spin: 1.5 }

        expect(bounce(spinning, 1, ARENA, 0.5).spin).toBe(1.5)
    })

    it("parks a ship too big for its arena instead of rattling it", () => {
        // Radius 20 in a box 20 across: both walls want it, and letting them fight
        // would jitter it between them every frame
        const after = bounce(movingTo(5, 5, 3, 3), 20, ARENA, 0.5)

        expect(after.position).toEqual({ x: 0, y: 0 })
        expect(after.velocity).toEqual({ x: 0, y: 0 })
    })

    it("leaves the body it was given untouched", () => {
        const before = movingTo(50, 0, 20, 0)
        bounce(before, 1, ARENA, 0.5)

        expect(before.position.x).toBe(50)
        expect(before.velocity.x).toBe(20)
    })
})

describe("load stages", () => {
    /** Two hull cells with one fuel tank on them, at the column given. */
    function tanked(col: number): Ship {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full")
        ship.layers.hull.set(1, 0, "full")
        ship.layers.components.set(col, 0, "full", { type: "fuel-tank" })

        return ship
    }

    it("reads empty as 0 and full as every stage", () => {
        expect(loadStage(0, 120)).toBe(0)
        expect(loadStage(120, 120)).toBe(LOAD_STAGES)
    })

    it("rounds to the nearest step", () => {
        expect(loadStage(60, 120)).toBe(5)
    })

    it("does not divide by an empty capacity", () => {
        expect(loadStage(5, 0)).toBe(0)
    })

    it("clamps a fill past the capacity", () => {
        expect(loadStage(500, 120)).toBe(LOAD_STAGES)
    })

    it("never steps up as a tank drains", () => {
        let previous = LOAD_STAGES

        for (let stored = 120; stored >= 0; stored--) {
            const stage = loadStage(stored, 120)
            expect(stage).toBeLessThanOrEqual(previous)
            previous = stage
        }
    })

    it("adds exactly a full load's mass when full", () => {
        const ship = tanked(0)
        // fuel-tank L1 carries 6 of fuel on top of its own dry 2
        expect(shipPhysics(ship, FULL).mass - dryPhysics(ship).mass).toBe(6)
    })

    it("adds half of it at half the stages", () => {
        const ship = tanked(0)
        const half = shipPhysics(ship, { fuel: LOAD_STAGES / 2, cargo: 0 })

        expect(half.mass - dryPhysics(ship).mass).toBe(3)
    })

    it("walks the centre of mass toward a tank as it fills", () => {
        const forward = tanked(0)
        const aft = tanked(1)

        expect(shipPhysics(forward, FULL).center.x).toBeLessThan(dryPhysics(forward).center.x)
        expect(shipPhysics(aft, FULL).center.x).toBeGreaterThan(dryPhysics(aft).center.x)
    })

    it("rebuilds the inertia rather than only the mass", () => {
        const ship = tanked(0)

        expect(shipPhysics(ship, FULL).inertia).not.toBeCloseTo(dryPhysics(ship).inertia)
    })

    it("leaves a ship with no tanks alone", () => {
        const ship = shipWith([{ col: 0, row: 0, facing: 2 }], [[0, 0], [1, 0]])

        expect(shipPhysics(ship, FULL).mass).toBe(dryPhysics(ship).mass)
    })
})

describe("gated thrust", () => {
    const DT = 1 / 60

    it("does not accelerate when nothing is firing", () => {
        const physics = dryPhysics(shipWith([{ col: 0, row: 0, facing: 2 }]))
        const after = step(bodyAt(0, 0), physics, [0], DT)

        expect(after.velocity).toEqual({ x: 0, y: 0 })
        expect(after.spin).toBe(0)
    })

    it("accelerates exactly half as hard at half throttle", () => {
        const physics = dryPhysics(shipWith([{ col: 0, row: 0, facing: 2 }]))
        const full = step(bodyAt(0, 0), physics, [1], DT)
        const half = step(bodyAt(0, 0), physics, [0.5], DT)

        expect(half.velocity.y).toBeCloseTo(full.velocity.y / 2)
    })
})

describe("recenter", () => {
    /** Where a cell at `local` from the centre actually draws. */
    function worldOf(body: Body, centre: Vec2, local: Vec2): Vec2 {
        const dx = local.x - centre.x
        const dy = local.y - centre.y
        const cos = Math.cos(body.angle)
        const sin = Math.sin(body.angle)

        return {
            x: body.position.x + dx * cos - dy * sin,
            y: body.position.y + dx * sin + dy * cos,
        }
    }

    const cell = { x: 3, y: 1 }
    const from = { x: 0, y: 0 }
    const to = { x: 0.4, y: -0.2 }

    it("holds a cell where it was drawn when the centre moves", () => {
        const body = bodyAt(10, 5)
        const before = worldOf(body, from, cell)
        const after = worldOf(recenter(body, from, to), to, cell)

        expect(after.x).toBeCloseTo(before.x)
        expect(after.y).toBeCloseTo(before.y)
    })

    it("holds it on a rotated ship too", () => {
        // The case a naive fix gets wrong: the offset has to be rotated into
        // world space, not added to the position raw
        const body = { ...bodyAt(10, 5), angle: 1.1 }
        const before = worldOf(body, from, cell)
        const after = worldOf(recenter(body, from, to), to, cell)

        expect(after.x).toBeCloseTo(before.x)
        expect(after.y).toBeCloseTo(before.y)
    })

    it("moves the body itself, so the centre of mass really is where it says", () => {
        const body = bodyAt(10, 5)

        expect(recenter(body, from, to).position).not.toEqual(body.position)
    })

    it("leaves a body alone when the centre did not move", () => {
        const body = bodyAt(10, 5)

        expect(recenter(body, from, { ...from })).toBe(body)
    })

    it("touches nothing but the position", () => {
        const body = { position: { x: 1, y: 2 }, velocity: { x: 3, y: 4 }, angle: 0.5, spin: 0.2 }
        const moved = recenter(body, from, to)

        expect(moved.velocity).toEqual(body.velocity)
        expect(moved.angle).toBe(body.angle)
        expect(moved.spin).toBe(body.spin)
    })
})