import { describe, expect, it } from "vitest"
import { approach } from "./ease"

describe("approach", () => {
    it("moves toward the target without overshooting it", () => {
        const next = approach(0, 1, 0.1, 1 / 60)

        expect(next).toBeGreaterThan(0)
        expect(next).toBeLessThan(1)
    })

    it("leaves exactly `retain` of the gap after a second", () => {
        expect(approach(0, 1, 0.25, 1)).toBeCloseTo(0.75)
    })

    it("does not depend on how many steps it took", () => {
        // The whole reason this is a pow and not a multiply: an ease that ran
        // slower on a slow machine would only ever be noticed by somebody else
        let stepped = 0
        for (let i = 0; i < 20; i++) stepped = approach(stepped, 1, 0.2, 0.05)

        expect(stepped).toBeCloseTo(approach(0, 1, 0.2, 1), 6)
    })

    it("works downward as well as up", () => {
        expect(approach(1, 0, 0.25, 1)).toBeCloseTo(0.25)
    })

    it("stays put when no time has passed", () => {
        expect(approach(0.3, 1, 0.5, 0)).toBe(0.3)
    })
})
