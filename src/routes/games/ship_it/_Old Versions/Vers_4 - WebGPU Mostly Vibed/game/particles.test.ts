import { describe, expect, it } from "vitest"
import { fadeOf, ParticleField, type Emission, type Particle } from "./particles"

/** Dead centre of every jitter range, so emission geometry is exact. */
const CENTERED = () => 0.5

/** A sequence, looped, for the cases where the spread itself is the subject. */
function sequence(...values: number[]): () => number {
    let index = 0
    return () => values[index++ % values.length]!
}

function eastward(overrides: Partial<Emission> = {}): Emission {
    return {
        at: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        speed: 10,
        life: 1,
        size: 0.2,
        red: 1,
        green: 1,
        blue: 1,
        ...overrides,
    }
}

function living(field: ParticleField): Particle[] {
    const out: Particle[] = []
    field.forEach((particle) => out.push(particle))
    return out
}

describe("emission", () => {
    it("puts a particle where it was asked for, moving the way it was pointed", () => {
        const field = new ParticleField(10, CENTERED)
        field.emit(1, eastward({ at: { x: 3, y: -2 } }))

        const [particle] = living(field)
        expect(particle!.position).toEqual({ x: 3, y: -2 })
        expect(particle!.velocity.x).toBeCloseTo(10)
        expect(particle!.velocity.y).toBeCloseTo(0)
    })

    it("adds drift, so exhaust inherits the ship it left", () => {
        const field = new ParticleField(10, CENTERED)
        field.emit(1, eastward({ drift: { x: -4, y: 7 } }))

        const [particle] = living(field)
        expect(particle!.velocity.x).toBeCloseTo(6)
        expect(particle!.velocity.y).toBeCloseTo(7)
    })

    it("spreads into a cone rather than a line", () => {
        // 0 and 1 are the extremes of the jitter range, so these are the cone's edges
        const field = new ParticleField(10, sequence(0, 1))
        field.emit(2, eastward({ spread: Math.PI / 4 }))

        const [low, high] = living(field)
        expect(Math.atan2(low!.velocity.y, low!.velocity.x)).toBeCloseTo(-Math.PI / 4)
        expect(Math.atan2(high!.velocity.y, high!.velocity.x)).toBeCloseTo(Math.PI / 4)
    })

    it("keeps the speed it was given when nothing jitters it", () => {
        const field = new ParticleField(10, sequence(0, 1))
        field.emit(2, eastward({ speed: 10 }))

        for (const particle of living(field)) expect(particle.velocity.x).toBeCloseTo(10)
    })

    it("varies speed by the fraction asked for", () => {
        const field = new ParticleField(10, sequence(0, 1))
        field.emit(2, eastward({ speed: 10, speedJitter: 0.5 }))

        const [slow, fast] = living(field)
        expect(slow!.velocity.x).toBeCloseTo(5)
        expect(fast!.velocity.x).toBeCloseTo(15)
    })

    it("never spawns a particle that is already dead", () => {
        // A full negative jitter would otherwise produce a zero lifetime, and a
        // particle born dead reads as a flicker
        const field = new ParticleField(10, () => 0)
        field.emit(1, eastward({ life: 1, lifeJitter: 1 }))

        const [particle] = living(field)
        expect(particle!.life).toBeGreaterThan(0)
        expect(fadeOf(particle!)).toBeCloseTo(1)
    })
})

describe("update", () => {
    it("carries a particle along its velocity", () => {
        const field = new ParticleField(10, CENTERED)
        field.emit(1, eastward({ speed: 10 }))

        field.update(0.5)

        const [particle] = living(field)
        expect(particle!.position.x).toBeCloseTo(5)
    })

    it("retires a particle once its life runs out", () => {
        const field = new ParticleField(10, CENTERED)
        field.emit(1, eastward({ life: 0.5 }))

        field.update(0.4)
        expect(field.count).toBe(1)

        field.update(0.2)
        expect(field.count).toBe(0)
    })

    it("retires the dead without taking the living with them", () => {
        // The bug this pins: removing by swapping leaves an unvisited particle at
        // the index just freed, so a loop that advances past it skips one
        const field = new ParticleField(10, CENTERED)
        field.emit(1, eastward({ life: 0.1 }))
        field.emit(1, eastward({ life: 0.1 }))
        field.emit(1, eastward({ life: 5 }))
        field.emit(1, eastward({ life: 0.1 }))

        field.update(0.2)

        expect(field.count).toBe(1)
        expect(living(field)[0]!.life).toBeCloseTo(4.8)
    })

    it("fades from one to zero across a lifetime", () => {
        const field = new ParticleField(10, CENTERED)
        field.emit(1, eastward({ life: 1 }))

        field.update(0.25)
        expect(fadeOf(living(field)[0]!)).toBeCloseTo(0.75)
    })
})

describe("capacity", () => {
    it("never holds more than it was built for", () => {
        const field = new ParticleField(3, CENTERED)
        field.emit(10, eastward())

        expect(field.count).toBe(3)
    })

    it("recycles rather than allocating once it is full", () => {
        const field = new ParticleField(2, CENTERED)
        field.emit(2, eastward({ life: 1 }))

        const before = living(field)
        field.emit(2, eastward({ life: 9 }))
        const after = living(field)

        // Same two objects, rewritten - the whole point of a fixed pool
        expect(after).toHaveLength(2)
        expect(new Set([...before, ...after]).size).toBe(2)
        for (const particle of after) expect(particle.life).toBeCloseTo(9)
    })

    it("holds at least one particle however small it is asked to be", () => {
        const field = new ParticleField(0, CENTERED)
        field.emit(5, eastward())

        expect(field.count).toBe(1)
    })

    it("empties on clear", () => {
        const field = new ParticleField(5, CENTERED)
        field.emit(5, eastward({ life: 100 }))
        field.clear()

        expect(field.count).toBe(0)
    })
})
