import { describe, expect, it } from "vitest"
import { ProjectileField, projectileFade, sweptDistanceSquared, type Shot } from "./projectiles"
import { targetAt, type Target } from "./targets"

const STILL = { x: 0, y: 0 }

function shot(patch: Partial<Shot> = {}): Shot {
    return {
        at: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        speed: 10,
        carry: STILL,
        damage: 5,
        range: 20,
        ...patch,
    }
}

function rockAt(x: number, y: number, radius = 1): Target {
    return targetAt({ x, y }, STILL, radius)
}

describe("swept distance", () => {
    it("measures to the nearest point on the step, not the end of it", () => {
        // The rock sits beside the middle of the path; an end-point test would
        // call this a clean miss at distance 10
        const at = sweptDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 })
        expect(at).toBeCloseTo(1)
    })

    it("ignores what is behind the muzzle", () => {
        const behind = sweptDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -4, y: 0 })
        expect(behind).toBeCloseTo(16)
    })

    it("handles a shot that did not move", () => {
        const still = sweptDistanceSquared({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 4 })
        expect(still).toBeCloseTo(25)
    })
})

describe("hits", () => {
    it("catches a rock crossed entirely within one frame", () => {
        // The regression this exists for: v1 tested the frame's end position only,
        // and its fast rounds passed straight through small rocks
        const field = new ProjectileField(8)
        field.fire(shot({ speed: 500, range: 500 }))

        const rock = rockAt(5, 0)
        const impacts = field.step(1 / 60, [rock])

        expect(impacts).toHaveLength(1)
        expect(rock.hitPoints).toBeLessThan(targetAt({ x: 0, y: 0 }, STILL, 1).hitPoints)
    })

    it("dies on the rock it hits rather than carrying on through the line", () => {
        const field = new ProjectileField(8)
        field.fire(shot({ speed: 500, range: 500 }))

        field.step(1 / 60, [rockAt(2, 0), rockAt(5, 0)])

        expect(field.count).toBe(0)
    })

    it("reports the hit that finished a rock off", () => {
        const field = new ProjectileField(8)
        field.fire(shot({ speed: 500, range: 500, damage: 10_000 }))

        const [impact] = field.step(1 / 60, [rockAt(5, 0)])
        expect(impact!.destroyed).toBe(true)
    })

    it("passes a destroyed rock by", () => {
        const field = new ProjectileField(8)
        field.fire(shot({ speed: 500, range: 500 }))

        const dead = rockAt(5, 0)
        dead.hitPoints = 0

        expect(field.step(1 / 60, [dead])).toEqual([])
        expect(field.count).toBe(1)
    })
})

describe("range", () => {
    it("expires at its range, not before", () => {
        const field = new ProjectileField(8)
        field.fire(shot({ speed: 10, range: 1 }))

        // 0.09 cells travelled of 1
        field.step(1 / 60 * 0.55, [])
        expect(field.count).toBe(1)

        field.step(1, [])
        expect(field.count).toBe(0)
    })

    it("inherits the ship's velocity, so a shot leads a moving hull", () => {
        const field = new ProjectileField(8)
        field.fire(shot({ speed: 10, carry: { x: 0, y: -20 } }))

        field.step(0.1, [])

        let seen: { x: number; y: number } | null = null
        field.forEach((p) => { seen = { ...p.position } })

        expect(seen!.y).toBeLessThan(0)
    })
})

describe("the pool", () => {
    it("drops the newest shot rather than deleting one already in flight", () => {
        // ParticleField recycles its oldest slot; doing that here would make a
        // round vanish mid-air, which is why this pool is its own thing
        const field = new ProjectileField(2)
        field.fire(shot({ damage: 1 }))
        field.fire(shot({ damage: 2 }))
        field.fire(shot({ damage: 3 }))

        const damages: number[] = []
        field.forEach((p) => damages.push(p.damage))

        expect(field.count).toBe(2)
        expect(damages.sort()).toEqual([1, 2])
    })
})

describe("running out of range", () => {
    it("draws at full brightness for most of the flight", () => {
        const field = new ProjectileField(4)
        field.fire(shot({ range: 20 }))

        let seen = 0
        field.forEach((p) => { seen = projectileFade(p) })

        expect(seen).toBe(1)
    })

    it("fades out over the last of it rather than vanishing", () => {
        // The failure this exists for: a round that simply stops being drawn
        // reads as a glitch, because the eye catches the disappearance
        const field = new ProjectileField(4)
        field.fire(shot({ speed: 10, range: 20 }))

        // 17 of 20 cells travelled: into the last 30% and dimming
        field.step(1.7, [])

        let seen = 1
        field.forEach((p) => { seen = projectileFade(p) })

        expect(seen).toBeGreaterThan(0)
        expect(seen).toBeLessThan(1)
    })

    it("is darker the closer it gets to its limit", () => {
        const field = new ProjectileField(4)
        field.fire(shot({ speed: 10, range: 20 }))

        field.step(1.6, [])
        let early = 1
        field.forEach((p) => { early = projectileFade(p) })

        field.step(0.3, [])
        let late = 1
        field.forEach((p) => { late = projectileFade(p) })

        expect(late).toBeLessThan(early)
    })

    it("survives a weapon with no range to speak of", () => {
        const field = new ProjectileField(4)
        field.fire(shot({ range: 0 }))

        field.forEach((p) => expect(Number.isFinite(projectileFade(p))).toBe(true))
    })
})
