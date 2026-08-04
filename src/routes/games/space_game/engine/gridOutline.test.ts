import { describe, expect, it } from "vitest"

import { Grid } from "./grid"
import { buildGridMesh } from "./gridMesh"
import { buildGridOutline } from "./gridOutline"
import { buildHull } from "./hulls"
import { DRAWN_SHAPES, type BlockShape } from "./shapes"

/**
 * Specification for block outlines.
 *
 * The property that matters is that interior edges cancel and boundary edges do
 * not — an outline with the triangulation still showing looks like a bug and a
 * silhouette that swallowed its block borders looks like a different one.
 */

const CELL = 10
const FLOATS_PER_VERTEX = 5
const FLOATS_PER_SEGMENT = FLOATS_PER_VERTEX * 2

function outline(shape: BlockShape, turns = 0): Float32Array {
    const grid = new Grid()
    grid.set(0, 0, shape, { turns, color: [1, 0, 0] })

    return buildGridOutline(grid, CELL)
}

function segments(data: Float32Array): number {
    expect(data.length % FLOATS_PER_SEGMENT).toBe(0)
    return data.length / FLOATS_PER_SEGMENT
}

describe("buildGridOutline", () => {
    it("outlines a full cell as four sides, not six", () => {
        // Six would mean the quad's shared diagonal survived.
        expect(segments(outline("full"))).toBe(4)
    })

    it.each([
        ["wedge", 3],
        ["half", 4],
        ["quarter", 4],
        ["halfWedge", 3],
        ["diamond", 4],
        ["band", 4],
    ] as const)("outlines %s with %i segments", (shape, expected) => {
        expect(segments(outline(shape))).toBe(expected)
    })

    it("keeps one segment per arc facet plus the two straight sides", () => {
        // Eight fan segments; the fan's radial edges cancel in pairs, leaving
        // the two outermost, which are the cell's own north and west edges.
        expect(segments(outline("arc"))).toBe(8 + 2)
    })

    it("draws every shape", () => {
        for (const shape of DRAWN_SHAPES) {
            expect(segments(outline(shape)), shape).toBeGreaterThan(2)
        }
    })

    it("keeps the border between two touching cells", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { color: [1, 0, 0] })
        grid.set(1, 0, "full", { color: [1, 0, 0] })

        // Four each: cancelling across cells would give a six-sided silhouette.
        expect(segments(buildGridOutline(grid, CELL))).toBe(8)
    })

    it("traces the same square the mesh fills", () => {
        const data = outline("full")

        const xs = [...data].filter((_, i) => i % FLOATS_PER_VERTEX === 0)
        const ys = [...data].filter((_, i) => i % FLOATS_PER_VERTEX === 1)

        // One centred cell spans -half to +half.
        expect(Math.min(...xs)).toBeCloseTo(-CELL / 2)
        expect(Math.max(...xs)).toBeCloseTo(CELL / 2)
        expect(Math.min(...ys)).toBeCloseTo(-CELL / 2)
        expect(Math.max(...ys)).toBeCloseTo(CELL / 2)
    })

    it("carries each cell's own colour by default", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { color: [0.25, 0.5, 0.75] })

        const data = buildGridOutline(grid, CELL)
        expect([data[2], data[3], data[4]]).toEqual([0.25, 0.5, 0.75])
    })

    it("paints every vertex one colour when given one", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { color: [1, 0, 0] })
        grid.set(1, 0, "wedge", { color: [0, 1, 0] })

        const data = buildGridOutline(grid, CELL, [0, 0.5, 1])

        for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) {
            expect([data[i + 2], data[i + 3], data[i + 4]]).toEqual([0, 0.5, 1])
        }
    })

    it("emits nothing for an empty grid", () => {
        expect(buildGridOutline(new Grid(), CELL)).toHaveLength(0)
    })

    it("rotates with the shape", () => {
        const north = outline("half", 0)
        const south = outline("half", 2)

        const lowest = (data: Float32Array) =>
            Math.max(...[...data].filter((_, i) => i % FLOATS_PER_VERTEX === 1))

        expect(lowest(north)).toBeLessThan(lowest(south))
    })

    // The real reason this exists — a hull's wireframe has to sit exactly on
    // top of its solid mesh, or the two views disagree about where the ship is.
    it("covers the same ground as a real hull's mesh", () => {
        const grid = buildHull("scytheShip")

        const bounds = (data: Float32Array) => {
            const xs = [...data].filter((_, i) => i % FLOATS_PER_VERTEX === 0)
            const ys = [...data].filter((_, i) => i % FLOATS_PER_VERTEX === 1)
            return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
        }

        expect(bounds(buildGridOutline(grid, CELL)))
            .toEqual(bounds(buildGridMesh(grid, CELL)))
    })
})
