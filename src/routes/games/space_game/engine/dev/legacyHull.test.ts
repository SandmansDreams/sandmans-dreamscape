import { describe, expect, it } from "vitest"

import { loadHull, loadHullDetailed, type HullData } from "../hull"
import { appendShape } from "../shapes"
import {
    convertLegacyHull, hexToRgb, LEGACY_SHAPES,
    type LegacyCell, type LegacyHull
} from "./legacyHull"

/**
 * Specification for the legacy conversion.
 *
 * The orientation table is the part worth testing: a wrong entry rotates every
 * cell of that kind across the whole fleet, and the result still renders — just
 * facing the wrong way. So rather than trusting the table's comments, every
 * entry is converted, tessellated, and checked against where its *legacy name*
 * says the mass should be.
 */

const SIZE = 20

function legacy(cells: LegacyHull["cells"]): LegacyHull {
    return { version: 1, cells }
}

/** Area-weighted centroid of a tessellated cell, in cell-local coordinates. */
function centroidOf(data: HullData): { x: number, y: number } {
    const grid = loadHull(data)
    const cell = grid.list[0]

    const out: number[] = []
    appendShape(out, cell.shape, cell.turns, cell.mirrored, 0, 0, SIZE, 1, 1, 1)

    let total = 0
    let cx = 0
    let cy = 0

    for (let i = 0; i + 14 < out.length; i += 15) {
        const [ax, ay] = [out[i], out[i + 1]]
        const [bx, by] = [out[i + 5], out[i + 6]]
        const [dx, dy] = [out[i + 10], out[i + 11]]

        const weight = Math.abs((bx - ax) * (dy - ay) - (dx - ax) * (by - ay)) / 2

        total += weight
        cx += ((ax + bx + dx) / 3) * weight
        cy += ((ay + by + dy) / 3) * weight
    }

    return { x: cx / total, y: cy / total }
}

describe("hexToRgb", () => {
    it("maps the channel extremes", () => {
        expect(hexToRgb("#ff0000")).toEqual([1, 0, 0])
        expect(hexToRgb("#000000")).toEqual([0, 0, 0])
        expect(hexToRgb("#ffffff")).toEqual([1, 1, 1])
    })

    it("expands the three-digit form", () => {
        expect(hexToRgb("#f80")).toEqual(hexToRgb("#ff8800"))
    })

    it("rounds to three decimals", () => {
        // 0x80 / 255 = 0.50196…
        expect(hexToRgb("#808080")).toEqual([0.502, 0.502, 0.502])
    })

    it("rejects anything that is not a colour", () => {
        expect(() => hexToRgb("#gg0000")).toThrow()
        expect(() => hexToRgb("blue")).toThrow()
    })
})

describe("LEGACY_SHAPES", () => {
    const CENTRE = SIZE / 2

    /**
     * Every legacy name ends in the compass directions its mass leans toward.
     *
     * That reading holds for all four families: `triSE` keeps the south-east
     * corner, `halfN` fills the north half, `rampEN` rests on the east edge and
     * rises to the north — and `arcNW` is a quarter disc *pinned* to the
     * north-west, which is the entry that catches the bite/pin inversion if it
     * is ever written the wrong way round.
     */
    const directions = (name: string) => name.replace(/^[a-z]+/, "")

    it.each(Object.keys(LEGACY_SHAPES))("%s leans the way its name says", (name) => {
        const { hull, warnings } = convertLegacyHull(
            legacy([{ c: 0, r: 0, s: name, color: "#ffffff" }])
        )

        expect(warnings).toEqual([])

        const c = centroidOf(hull)

        for (const direction of directions(name)) {
            if (direction === "N") expect(c.y).toBeLessThan(CENTRE)
            if (direction === "S") expect(c.y).toBeGreaterThan(CENTRE)
            if (direction === "W") expect(c.x).toBeLessThan(CENTRE)
            if (direction === "E") expect(c.x).toBeGreaterThan(CENTRE)
        }
    })

    it("leaves a full cell centred", () => {
        const { hull } = convertLegacyHull(legacy([{ c: 0, r: 0, s: "full", color: "#ffffff" }]))
        const c = centroidOf(hull)

        expect(c.x).toBeCloseTo(CENTRE)
        expect(c.y).toBeCloseTo(CENTRE)
    })

    // The eight legacy ramps have to survive the trip through four turns plus a
    // mirror without two of them colliding on the same orientation.
    it("gives every ramp a distinct orientation", () => {
        const ramps = Object.entries(LEGACY_SHAPES)
            .filter(([name]) => name.startsWith("ramp"))
            .map(([, o]) => `${o.t}|${o.m ?? false}`)

        expect(ramps).toHaveLength(8)
        expect(new Set(ramps).size).toBe(8)
    })

    it("produces only shapes the loader knows", () => {
        for (const name of Object.keys(LEGACY_SHAPES)) {
            const { hull } = convertLegacyHull(
                legacy([{ c: 0, r: 0, s: name, color: "#ffffff" }])
            )
            expect(loadHullDetailed(hull).warnings).toEqual([])
        }
    })
})

describe("convertLegacyHull", () => {
    it("names colours by family, light to dark", () => {
        const { hull } = convertLegacyHull(legacy([
            { c: 0, r: 0, s: "full", color: "#176515" },   // dark green
            { c: 1, r: 0, s: "full", color: "#459744" },   // lighter green
            { c: 2, r: 0, s: "full", color: "#808080" },   // grey
        ]))

        expect(Object.keys(hull.palette).sort()).toEqual(["green1", "green2", "grey"])
        expect(hull.palette.green1).toEqual(hexToRgb("#459744"))
        expect(hull.palette.green2).toEqual(hexToRgb("#176515"))
    })

    it("reuses one palette entry for a repeated colour", () => {
        const { hull } = convertLegacyHull(legacy([
            { c: 0, r: 0, s: "full", color: "#ff0000" },
            { c: 0, r: 1, s: "triNW", color: "#ff0000" },
        ]))

        expect(Object.keys(hull.palette)).toHaveLength(1)
    })

    it("drops an unknown shape and keeps the rest", () => {
        const { hull, warnings } = convertLegacyHull(legacy([
            { c: 0, r: 0, s: "triangleish", color: "#ff0000" },
            { c: 1, r: 0, s: "full", color: "#ff0000" },
        ]))

        expect(loadHull(hull).count).toBe(1)
        expect(warnings[0]).toContain("triangleish")
    })

    it("reports dropped placements and attachments", () => {
        const { warnings } = convertLegacyHull({
            cells: [{ c: 0, r: 0, s: "full", color: "#ff0000", placement: { type: "turret" } }],
            attachments: [{ r: 1, c: 1 }]
        })

        expect(warnings.join(" ")).toContain("1 placement")
        expect(warnings.join(" ")).toContain("1 attachment")
    })

    it("survives a file with no cells", () => {
        const { hull, warnings } = convertLegacyHull({} as LegacyHull)

        expect(hull.cells).toEqual([])
        expect(warnings).toHaveLength(1)
    })

    // Compaction is the only step that can silently lose or invent a cell, so
    // it is checked against the grid it is supposed to be equivalent to.
    describe("compaction", () => {
        /** A solid 5x4 rectangle of identical cells. */
        function block(): LegacyCell[] {
            const cells: LegacyCell[] = []
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 5; c++) {
                    cells.push({ c, r, s: "full", color: "#ff0000" })
                }
            }
            return cells
        }

        it("collapses a solid block into one entry", () => {
            const { hull } = convertLegacyHull(legacy(block()))

            expect(hull.cells).toHaveLength(1)
            expect(hull.cells[0]).toMatchObject({ c: 0, r: 0, c2: 4, r2: 3 })
        })

        it("expands back to exactly the same grid", () => {
            const cells = block()
            cells[7] = { ...cells[7], color: "#0000ff" }
            cells.push({ c: 9, r: 9, s: "arcNE", color: "#00ff00" })

            const { hull } = convertLegacyHull(legacy(cells))
            const compacted = loadHull(hull)

            const expanded = loadHull({
                ...hull,
                cells: hull.cells.flatMap(cell => {
                    const out = []
                    for (let r = cell.r; r <= (cell.r2 ?? cell.r); r++) {
                        for (let c = cell.c; c <= (cell.c2 ?? cell.c); c++) {
                            out.push({ ...cell, c, r, c2: undefined, r2: undefined })
                        }
                    }
                    return out
                })
            })

            expect(compacted.count).toBe(expanded.count)
            for (const cell of expanded.list) {
                expect(compacted.get(cell.col, cell.row)).toEqual(cell)
            }
        })

        it("does not merge across differing shape, turn or colour", () => {
            const { hull } = convertLegacyHull(legacy([
                { c: 0, r: 0, s: "full", color: "#ff0000" },
                { c: 1, r: 0, s: "full", color: "#0000ff" },
                { c: 2, r: 0, s: "triNW", color: "#ff0000" },
            ]))

            expect(hull.cells).toHaveLength(3)
        })

        it("does not merge across a gap", () => {
            const { hull } = convertLegacyHull(legacy([
                { c: 0, r: 0, s: "full", color: "#ff0000" },
                { c: 2, r: 0, s: "full", color: "#ff0000" },
            ]))

            expect(hull.cells).toHaveLength(2)
        })

        it("omits defaulted turns and mirroring", () => {
            const { hull } = convertLegacyHull(legacy([
                { c: 0, r: 0, s: "full", color: "#ff0000" },
            ]))

            expect(hull.cells[0].t).toBeUndefined()
            expect(hull.cells[0].m).toBeUndefined()
        })
    })
})
