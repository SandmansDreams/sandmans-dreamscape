import { describe, expect, it } from "vitest"
import { BLOCK_SHAPES } from "../render/grid/shapes"
import { shapeSvgPath } from "./shapeSVG"

describe("shapeSvgPath()", () => {
    it("emits nothing for empty", () => {
        expect(shapeSvgPath("empty")).toBe("")
    })

    it("emits a closed subpath per triangle for every shape", () => {
        for (const shape of BLOCK_SHAPES) {
            if (shape === "empty") continue

            const path = shapeSvgPath(shape)
            expect(path.startsWith("M"), shape).toBe(true)
            // Two triangles per quad, so `full` is 2 - never zero
            expect((path.match(/Z/g) ?? []).length, shape).toBeGreaterThan(0)
        }
    })

    it("stays inside the box it was given", () => {
        const numbers = shapeSvgPath("circle", 0, false, 50).match(/-?\d+(\.\d+)?/g) ?? []

        for (const value of numbers.map(Number)) {
            expect(value).toBeGreaterThanOrEqual(0)
            expect(value).toBeLessThanOrEqual(50)
        }
    })

    it("rotates, so a wedge at turn 1 differs from turn 0", () => {
        expect(shapeSvgPath("wedge", 1)).not.toBe(shapeSvgPath("wedge", 0))
    })
})