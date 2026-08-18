import { describe, expect, it } from "vitest"
import { Color } from "../render/color"
import { Light, LightField, UNLIT } from "./lighting"

const RED = Color.from("#ff0000")
const BLUE = Color.from("#0000ff")

const ORIGIN = { x: 0, y: 0 }

function fieldWith(...lights: Light[]): LightField {
    const field = new LightField()
    for (const light of lights) field.add(light)
    return field
}

describe("falloff", () => {
    it("is at full strength on top of the light", () => {
        const light = new Light({ position: ORIGIN, intensity: 1, range: 100 })
        expect(light.reach(0)).toBeCloseTo(1)
    })

    it("halves at the range it was given", () => {
        const light = new Light({ position: ORIGIN, intensity: 1, range: 100 })
        expect(light.reach(100 * 100)).toBeCloseTo(0.5)
    })

    it("keeps a tail rather than cutting off", () => {
        // Inverse-square with a soft core: a tenth of peak at three ranges out,
        // which is what stops a light having a visible edge in space
        const light = new Light({ position: ORIGIN, intensity: 1, range: 100 })
        expect(light.reach(300 * 300)).toBeCloseTo(0.1)
    })
})

describe("sampling", () => {
    it("points at the only light there is", () => {
        const field = fieldWith(new Light({ position: { x: 100, y: 0 }, range: 500 }))

        const surface = field.sample(ORIGIN, 0)
        expect(surface.direction.x).toBeCloseTo(1)
        expect(surface.direction.y).toBeCloseTo(0)
        expect(surface.intensity).toBeGreaterThan(0)
    })

    it("rotates the direction into the hull's own frame", () => {
        // A light due east of a hull turned a quarter turn is off its own bow
        const field = fieldWith(new Light({ position: { x: 100, y: 0 }, range: 500 }))

        const surface = field.sample(ORIGIN, Math.PI / 2)
        expect(surface.direction.x).toBeCloseTo(0)
        expect(surface.direction.y).toBeCloseTo(-1)
    })

    it("leans toward the brighter of two lights", () => {
        const field = fieldWith(
            new Light({ position: { x: 100, y: 0 }, range: 500, intensity: 1 }),
            new Light({ position: { x: 0, y: 100 }, range: 500, intensity: 0.1 }),
        )

        const surface = field.sample(ORIGIN, 0)
        expect(surface.direction.x).toBeGreaterThan(surface.direction.y)
        expect(surface.direction.y).toBeGreaterThan(0)
    })

    it("gives up when opposed lights cancel exactly", () => {
        // No direction left to shade from, so flat is the honest answer
        const field = fieldWith(
            new Light({ position: { x: 100, y: 0 }, range: 500 }),
            new Light({ position: { x: -100, y: 0 }, range: 500 }),
        )

        expect(field.sample(ORIGIN, 0)).toBe(UNLIT)
    })

    it("returns unlit when everything is too far to matter", () => {
        const field = fieldWith(new Light({ position: { x: 1e6, y: 0 }, range: 10 }))
        expect(field.sample(ORIGIN, 0)).toBe(UNLIT)
    })

    it("is unlit with no lights at all", () => {
        expect(new LightField().sample(ORIGIN, 0)).toBe(UNLIT)
    })

    it("mixes the tint by how much each light contributed", () => {
        // Equal and adjacent, so the tint is the average of the two colours
        const field = fieldWith(
            new Light({ position: { x: 100, y: 0 }, range: 500, color: RED }),
            new Light({ position: { x: 100, y: 1 }, range: 500, color: BLUE }),
        )

        const { tint } = field.sample(ORIGIN, 0)
        expect(tint.r).toBeCloseTo(0.5, 1)
        expect(tint.b).toBeCloseTo(0.5, 1)
        expect(tint.g).toBeCloseTo(0)
    })

    it("takes its tint from the nearer light when one dominates", () => {
        const field = fieldWith(
            new Light({ position: { x: 10, y: 0 }, range: 500, color: RED }),
            new Light({ position: { x: 5000, y: 0 }, range: 500, color: BLUE }),
        )

        const { tint } = field.sample(ORIGIN, 0)
        expect(tint.r).toBeGreaterThan(0.9)
        expect(tint.b).toBeLessThan(0.1)
    })

    it("never reports more than fully lit", () => {
        const field = fieldWith(
            new Light({ position: { x: 1, y: 0 }, range: 500, intensity: 5 }),
            new Light({ position: { x: 2, y: 0 }, range: 500, intensity: 5 }),
        )

        expect(field.sample(ORIGIN, 0).intensity).toBe(1)
    })

    it("skips a light the hull itself carries", () => {
        // A ship's own engine glow sits inside its hull: there is no direction to
        // it, and its near-field strength would wash the whole sprite out
        const ship = { name: "mine" }
        const field = fieldWith(
            new Light({ position: { x: 1, y: 0 }, range: 500, intensity: 5, owner: ship }),
        )

        expect(field.sample(ORIGIN, 0, ship)).toBe(UNLIT)
        expect(field.sample(ORIGIN, 0).intensity).toBe(1)
    })

    it("still counts other hulls' lights while skipping its own", () => {
        const ship = { name: "mine" }
        const field = fieldWith(
            new Light({ position: { x: 1, y: 0 }, range: 500, owner: ship }),
            new Light({ position: { x: 0, y: 100 }, range: 500 }),
        )

        const surface = field.sample(ORIGIN, 0, ship)
        expect(surface.direction.y).toBeCloseTo(1)
    })
})

describe("the field itself", () => {
    it("forgets a light that was removed", () => {
        const field = new LightField()
        const light = field.add(new Light({ position: { x: 100, y: 0 }, range: 500 }))

        expect(field.sample(ORIGIN, 0)).not.toBe(UNLIT)
        field.remove(light)
        expect(field.sample(ORIGIN, 0)).toBe(UNLIT)
    })

    it("empties on clear", () => {
        const field = fieldWith(new Light({ position: { x: 100, y: 0 }, range: 500 }))
        field.clear()

        expect(field.lights).toHaveLength(0)
    })
})
