import { describe, expect, it } from "vitest"
import { Grid, type RGB } from "./grid"
import { loadHull, loadHullDetailed, saveHull, type HullData } from "./hull"
import { buildDemoShip } from "./demoShip"

const PALETTE: Record<string, RGB> = {
    hull: [0.5, 0.5, 0.5],
    accent: [1, 0, 0]
}

function hull(cells: HullData["cells"]): HullData {
    return { version: 1, palette: PALETTE, cells }
}

describe("loadHull", () => {
    it("places a single cell", () => {
        const grid = loadHull(hull([{ c: 2, r: 3, s: "full", p: "hull" }]))

        expect(grid.count).toBe(1)
        expect(grid.get(2, 3)).toMatchObject({ shape: "full", turns: 0, mirrored: false })
    })

    it("applies the named palette colour", () => {
        const grid = loadHull(hull([{ c: 0, r: 0, s: "full", p: "accent" }]))
        const cell = grid.get(0, 0)!

        expect([cell.r, cell.g, cell.b]).toEqual([1, 0, 0])
    })

    it("carries turns and mirroring", () => {
        const grid = loadHull(hull([{ c: 0, r: 0, s: "halfWedge", t: 2, m: true, p: "hull" }]))

        expect(grid.get(0, 0)).toMatchObject({ turns: 2, mirrored: true })
    })

    it("defaults turns to 0 and mirrored to false", () => {
        const grid = loadHull(hull([{ c: 0, r: 0, s: "wedge", p: "hull" }]))

        expect(grid.get(0, 0)).toMatchObject({ turns: 0, mirrored: false })
    })

    // The compaction that makes hull files readable — worth pinning that it
    // expands to exactly the same thing as writing the cells out one by one.
    describe("rectangles", () => {
        it("expands c2/r2 into every cell between", () => {
            const grid = loadHull(hull([{ c: 1, r: 1, c2: 3, r2: 2, s: "full", p: "hull" }]))

            expect(grid.count).toBe(6)
            for (let col = 1; col <= 3; col++) {
                for (let row = 1; row <= 2; row++) {
                    expect(grid.has(col, row)).toBe(true)
                }
            }
        })

        it("matches the equivalent individual cells", () => {
            const asRect = loadHull(hull([{ c: 0, r: 0, c2: 2, s: "full", p: "hull" }]))
            const asCells = loadHull(hull([
                { c: 0, r: 0, s: "full", p: "hull" },
                { c: 1, r: 0, s: "full", p: "hull" },
                { c: 2, r: 0, s: "full", p: "hull" },
            ]))

            expect(saveHull(asRect, PALETTE).cells).toEqual(saveHull(asCells, PALETTE).cells)
        })

        it("accepts only one axis extended", () => {
            const grid = loadHull(hull([{ c: 0, r: 0, r2: 3, s: "full", p: "hull" }]))
            expect(grid.count).toBe(4)
        })
    })

    // A hand-edited or older file should cost you a block, not the whole ship.
    describe("bad input", () => {
        it("drops a cell with an unknown shape and keeps the rest", () => {
            const { grid, warnings } = loadHullDetailed(hull([
                { c: 0, r: 0, s: "notAShape" as never, p: "hull" },
                { c: 1, r: 0, s: "full", p: "hull" },
            ]))

            expect(grid.count).toBe(1)
            expect(grid.has(1, 0)).toBe(true)
            expect(warnings).toHaveLength(1)
            expect(warnings[0]).toContain("notAShape")
        })

        it("drops a cell whose palette key is missing", () => {
            const { grid, warnings } = loadHullDetailed(hull([
                { c: 0, r: 0, s: "full", p: "nope" },
                { c: 1, r: 0, s: "full", p: "hull" },
            ]))

            expect(grid.count).toBe(1)
            expect(warnings[0]).toContain("nope")
        })

        it("survives a payload with no cells array", () => {
            const { grid, warnings } = loadHullDetailed({ version: 1, palette: {} } as HullData)

            expect(grid.count).toBe(0)
            expect(warnings).toHaveLength(1)
        })

        it("falls back to the default colour when no palette key is given", () => {
            const { grid, warnings } = loadHullDetailed(hull([{ c: 0, r: 0, s: "full" }]))

            expect(grid.count).toBe(1)
            expect(warnings).toHaveLength(0)
        })
    })
})

describe("saveHull", () => {
    it("round-trips a grid", () => {
        const original = new Grid()
        original.set(0, 0, "full", { color: PALETTE.hull })
        original.set(1, 0, "wedge", { turns: 2, color: PALETTE.accent })
        original.set(0, 1, "halfWedge", { turns: 1, mirrored: true, color: PALETTE.hull })

        const reloaded = loadHull(saveHull(original, PALETTE))

        expect(reloaded.count).toBe(original.count)
        for (const cell of original.list) {
            expect(reloaded.get(cell.col, cell.row)).toEqual(cell)
        }
    })

    it("omits defaulted turns and mirroring", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { color: PALETTE.hull })

        const [cell] = saveHull(grid, PALETTE).cells
        expect(cell.t).toBeUndefined()
        expect(cell.m).toBeUndefined()
    })

    it("invents palette entries for unmatched colours rather than losing them", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { color: [0.1, 0.2, 0.3] })

        const data = saveHull(grid, PALETTE)
        const reloaded = loadHull(data)
        const cell = reloaded.get(0, 0)!

        expect([cell.r, cell.g, cell.b]).toEqual([0.1, 0.2, 0.3])
    })
})

describe("demoShip.json", () => {
    it("loads cleanly", () => {
        const { warnings } = loadHullDetailed(
            // Re-run through the detailed path so warnings are inspectable.
            JSON.parse(JSON.stringify(
                saveHull(buildDemoShip())
            ))
        )

        expect(warnings).toEqual([])
    })

    it("has the expected extent", () => {
        const grid = buildDemoShip()

        expect(grid.count).toBe(32)
        expect(grid.extent).toEqual({ width: 6, height: 9 })
    })
})
