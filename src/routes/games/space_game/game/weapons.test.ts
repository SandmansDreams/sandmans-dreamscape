import { describe, expect, it } from "vitest"
import { DRY, shipPhysics } from "./physics"
import { Ship } from "./ship"
import {
    aimOf, angleDelta, coolDown, freshStates, isTurret, recoverRecoil, RECOIL_KICK,
    shotSpeed, weaponMountsOf, willFire,
    type WeaponMount, type WeaponState,
} from "./weapons"

const DT = 1 / 60

function shipWith(parts: { type: string; col: number; row: number; facing?: number }[]): Ship {
    const ship = new Ship("t", "T")
    ship.layers.hull.set(0, 0, "full")

    for (const part of parts) {
        ship.layers.components.set(part.col, part.row, "full", {
            type: part.type,
            facing: part.facing ?? 0,
        })
    }

    return ship
}

function mountsOf(parts: Parameters<typeof shipWith>[0]): WeaponMount[] {
    const ship = shipWith(parts)
    return weaponMountsOf(ship, shipPhysics(ship, DRY))
}

/** A turret pointing along +x, so aims are easy to read. */
function turret(patch: Partial<WeaponMount> = {}): WeaponMount {
    return {
        layer: "components", col: 0, row: 0, offset: { x: 0, y: 0 },
        facing: 0, damage: 5, cooldown: 0.2, range: 20, draw: 1, traverse: 3,
        ...patch,
    }
}

describe("mounts", () => {
    it("finds every weapon and nothing else", () => {
        const mounts = mountsOf([
            { type: "autocannon", col: 0, row: 0 },
            { type: "ion-thruster", col: 1, row: 0 },
            { type: "railgun", col: 2, row: 0 },
        ])

        expect(mounts).toHaveLength(2)
    })

    it("reads traverse from the registry, so a railgun is fixed", () => {
        const [cannon] = mountsOf([{ type: "autocannon", col: 0, row: 0 }])
        const [rail] = mountsOf([{ type: "railgun", col: 0, row: 0 }])

        expect(isTurret(cannon!)).toBe(true)
        expect(isTurret(rail!)).toBe(false)
    })

    it("remembers which layer it came off", () => {
        // The failure this guards: a weapon sits over a hull plate at the same
        // column and row, and a lookup that searched the layers in order found the
        // plate every time - which left every turret with no barrel to draw
        const [mount] = mountsOf([{ type: "autocannon", col: 0, row: 0 }])

        expect(mount!.layer).toBe("components")
    })

    it("points a mount the way its block was placed", () => {
        const [north] = mountsOf([{ type: "railgun", col: 0, row: 0, facing: 0 }])
        const [south] = mountsOf([{ type: "railgun", col: 0, row: 0, facing: 2 }])

        expect(Math.abs(angleDelta(north!.facing, south!.facing))).toBeCloseTo(Math.PI)
    })
})

describe("angles", () => {
    it("takes the short way round", () => {
        expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2)
        // Across the wrap, not the long way back through zero
        expect(angleDelta(3.0, -3.0)).toBeCloseTo(0.2832, 3)
    })
})

describe("aiming", () => {
    it("slews a turret at its traverse rate and no faster", () => {
        const mount = turret({ traverse: 3 })
        const state: WeaponState = { cooldown: 0, angle: 0, recoil: 0 }

        // Asked to spin right round in one frame; it may move 3 * dt
        expect(aimOf(mount, state, Math.PI, DT)).toBeCloseTo(3 * DT)
    })

    it("lands exactly on the aim once it is within reach", () => {
        const mount = turret({ traverse: 3 })
        const state: WeaponState = { cooldown: 0, angle: 0, recoil: 0 }

        expect(aimOf(mount, state, 0.01, DT)).toBeCloseTo(0.01)
    })

    it("leaves a fixed mount welded to its facing", () => {
        const rail = turret({ traverse: 0, facing: 1.2 })
        const state: WeaponState = { cooldown: 0, angle: 1.2, recoil: 0 }

        expect(aimOf(rail, state, -2.5, DT)).toBeCloseTo(1.2)
    })
})

describe("firing", () => {
    it("holds a turret until it is lined up", () => {
        const mount = turret()
        const wide: WeaponState = { cooldown: 0, angle: 0, recoil: 0 }

        expect(willFire(mount, wide, 2, true, true)).toBe(false)
        expect(willFire(mount, wide, 0.01, true, true)).toBe(true)
    })

    it("fires a fixed mount the moment the trigger is down", () => {
        // It cannot line itself up, so waiting for alignment would mean never
        const rail = turret({ traverse: 0 })
        const state: WeaponState = { cooldown: 0, angle: 0, recoil: 0 }

        expect(willFire(rail, state, 3.0, true, true)).toBe(true)
    })

    it("will not fire without the trigger, the power, or the cooldown", () => {
        const mount = turret()
        const ready: WeaponState = { cooldown: 0, angle: 0, recoil: 0 }

        expect(willFire(mount, ready, 0, false, true)).toBe(false)
        expect(willFire(mount, ready, 0, true, false)).toBe(false)
        expect(willFire(mount, { cooldown: 0.1, angle: 0, recoil: 0 }, 0, true, true)).toBe(false)
    })
})

describe("cooldowns", () => {
    it("counts down and stops at zero", () => {
        const states = [{ cooldown: 0.05, angle: 0, recoil: 0 }, { cooldown: 0, angle: 0, recoil: 0 }]
        coolDown(states, 0.1)

        expect(states[0]!.cooldown).toBe(0)
        expect(states[1]!.cooldown).toBe(0)
    })

    it("starts every mount ready and on its own facing", () => {
        const mounts = mountsOf([{ type: "railgun", col: 0, row: 0, facing: 2 }])
        const [state] = freshStates(mounts)

        expect(state!.cooldown).toBe(0)
        expect(state!.angle).toBeCloseTo(mounts[0]!.facing)
    })
})

describe("shot speed", () => {
    it("comes from range, so range stays the one knob", () => {
        const [rail] = mountsOf([{ type: "railgun", col: 0, row: 0 }])
        const [cannon] = mountsOf([{ type: "autocannon", col: 0, row: 0 }])

        expect(shotSpeed(rail!)).toBeGreaterThan(shotSpeed(cannon!))
    })
})

describe("recoil", () => {
    it("eases back toward rest rather than snapping", () => {
        const states = [{ cooldown: 0, angle: 0, recoil: RECOIL_KICK }]

        recoverRecoil(states, 1 / 60)
        const afterOneFrame = states[0]!.recoil

        expect(afterOneFrame).toBeLessThan(RECOIL_KICK)
        expect(afterOneFrame).toBeGreaterThan(0)
    })

    it("settles at exactly zero rather than creeping forever", () => {
        const states = [{ cooldown: 0, angle: 0, recoil: RECOIL_KICK }]
        recoverRecoil(states, 1)

        expect(states[0]!.recoil).toBe(0)
    })

    it("recovers the same amount however many steps it took", () => {
        // Framerate independence: a kick must not last longer on a slow machine
        const coarse = [{ cooldown: 0, angle: 0, recoil: RECOIL_KICK }]
        const fine = [{ cooldown: 0, angle: 0, recoil: RECOIL_KICK }]

        recoverRecoil(coarse, 0.1)
        for (let i = 0; i < 10; i++) recoverRecoil(fine, 0.01)

        expect(fine[0]!.recoil).toBeCloseTo(coarse[0]!.recoil, 5)
    })

    it("starts every barrel at rest", () => {
        const mounts = mountsOf([{ type: "autocannon", col: 0, row: 0 }])
        expect(freshStates(mounts)[0]!.recoil).toBe(0)
    })
})
