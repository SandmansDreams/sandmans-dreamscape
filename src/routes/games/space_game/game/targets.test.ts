import { describe, expect, it } from "vitest"
import {
    driftTarget, hitPointsFor, isDestroyed, splitTarget, SPLIT_FLOOR, targetAt,
} from "./targets"

/** A random source a test chose, so nothing here depends on luck. */
function fixed(...values: number[]): () => number {
    let at = 0
    return () => values[at++ % values.length]!
}

const rock = (radius: number) => targetAt({ x: 0, y: 0 }, { x: 0, y: 0 }, radius)

describe("toughness", () => {
    it("scales with area, so splitting neither creates nor destroys it", () => {
        const parent = hitPointsFor(2)
        // Four rocks of half the radius have exactly the parent's area
        expect(hitPointsFor(1) * 4).toBeCloseTo(parent, 0)
    })

    it("never leaves a rock that cannot be destroyed", () => {
        expect(hitPointsFor(0.01)).toBeGreaterThan(0)
    })
})

describe("drift", () => {
    it("moves and turns by the time given", () => {
        const target = targetAt({ x: 0, y: 0 }, { x: 2, y: -1 }, 1, 0.5)
        driftTarget(target, 0.5)

        expect(target.position.x).toBeCloseTo(1)
        expect(target.position.y).toBeCloseTo(-0.5)
        expect(target.angle).toBeCloseTo(0.25)
    })
})

describe("splitting", () => {
    it("gives smaller children than the rock they came from", () => {
        const parent = rock(3)
        const shards = splitTarget(parent, fixed(0.5))

        expect(shards.length).toBeGreaterThan(0)
        for (const shard of shards) expect(shard.radius).toBeLessThan(parent.radius)
    })

    it("stops at the floor rather than making dust forever", () => {
        expect(splitTarget(rock(SPLIT_FLOOR - 0.01), fixed(0.5))).toEqual([])
    })

    it("terminates: splitting repeatedly runs out", () => {
        // The guard this pins is the whole reason a floor exists - without it a
        // rock is an infinite supply of smaller rocks
        let generation = [rock(4)]

        for (let round = 0; round < 12 && generation.length > 0; round++) {
            generation = generation.flatMap((target) => splitTarget(target, fixed(0.5)))
        }

        expect(generation).toEqual([])
    })

    it("throws shards outward rather than leaving them stacked", () => {
        const shards = splitTarget(rock(3), fixed(0.5))
        const distances = shards.map((s) => Math.hypot(s.position.x, s.position.y))

        for (const distance of distances) expect(distance).toBeGreaterThan(0)
    })

    it("carries the parent's motion into every shard", () => {
        const parent = targetAt({ x: 0, y: 0 }, { x: 10, y: 0 }, 3)
        const shards = splitTarget(parent, fixed(0.5))

        // Every shard keeps heading the way the rock was going, plus its own push
        for (const shard of shards) expect(shard.velocity.x).toBeGreaterThan(0)
    })
})

describe("damage", () => {
    it("is destroyed only once its hit points are gone", () => {
        const target = rock(1)
        target.hitPoints = 1
        expect(isDestroyed(target)).toBe(false)

        target.hitPoints = 0
        expect(isDestroyed(target)).toBe(true)
    })
})
