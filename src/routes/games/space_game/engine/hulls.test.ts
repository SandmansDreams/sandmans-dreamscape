import { describe, expect, it } from "vitest"

import { buildHull, HULLS } from "./hulls"
import { loadHullDetailed } from "./hull"
import { BLOCK_SHAPES } from "./shapes"

/**
 * Specification for the shipped hull files.
 *
 * These are data, not code, so nothing else would catch a shape name or palette
 * key that stops being valid — the ship would just render with a hole in it.
 * The loader is deliberately lenient, which is right at runtime and exactly why
 * the strictness has to live here instead.
 */

const KNOWN_SHAPES = new Set<string>(BLOCK_SHAPES)

describe("engine/hulls", () => {
    it("finds the hull files", () => {
        expect(HULLS.length).toBeGreaterThanOrEqual(5)
        expect(HULLS.map(entry => entry.id)).toContain("scytheShip")
    })

    it("gives every hull a distinct id and a readable name", () => {
        const ids = HULLS.map(entry => entry.id)
        expect(new Set(ids).size).toBe(ids.length)

        for (const entry of HULLS) {
            expect(entry.name.length).toBeGreaterThan(0)
        }
    })

    it.each(HULLS.map(entry => [entry.id, entry] as const))("%s loads without warnings", (_, entry) => {
        const { grid, warnings } = loadHullDetailed(entry.data)

        expect(warnings).toEqual([])
        expect(grid.count).toBeGreaterThan(0)
    })

    it.each(HULLS.map(entry => [entry.id, entry] as const))("%s is internally consistent", (_, entry) => {
        for (const cell of entry.data.cells) {
            expect(KNOWN_SHAPES, `shape "${cell.s}"`).toContain(cell.s)

            if (cell.p !== undefined) {
                expect(Object.keys(entry.data.palette), `palette key "${cell.p}"`).toContain(cell.p)
            }
            if (cell.c2 !== undefined) expect(cell.c2).toBeGreaterThanOrEqual(cell.c)
            if (cell.r2 !== undefined) expect(cell.r2).toBeGreaterThanOrEqual(cell.r)
        }

        for (const [key, rgb] of Object.entries(entry.data.palette)) {
            expect(rgb, key).toHaveLength(3)
            for (const channel of rgb) {
                expect(channel, key).toBeGreaterThanOrEqual(0)
                expect(channel, key).toBeLessThanOrEqual(1)
            }
        }
    })

    it("builds an independent grid each time", () => {
        const first = buildHull("scytheShip")
        const second = buildHull("scytheShip")

        first.clear()
        expect(second.count).toBeGreaterThan(0)
    })

    it("throws on an unknown id rather than returning an empty ship", () => {
        expect(() => buildHull("noSuchShip")).toThrow(/noSuchShip/)
    })
})
