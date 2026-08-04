import { describe, expect, it } from "vitest"

import { Grid } from "./grid"
import { buildGridMesh, LIT_MESH_STRIDE, MESH_STRIDE } from "./gridMesh"
import { buildHull } from "./hulls"

/**
 * Specification for grid meshes, and in particular for the cell centres the lit
 * shader reads.
 *
 * Per-cell shading only stays per cell because every vertex of a block reports
 * the same centre. If that ever drifted — an off-by-one in the loop, a centre
 * taken from the wrong cell — the result would be a smooth gradient across each
 * block instead of a flat tone, which is subtle enough on screen to miss.
 */

const CELL = 10

function mesh(withCentres = false, ...cells: [number, number][]): Float32Array {
    const grid = new Grid()
    for (const [col, row] of cells) grid.set(col, row, "full", { color: [1, 0, 0] })

    return buildGridMesh(grid, CELL, withCentres)
}

describe("buildGridMesh", () => {
    it("centres a single cell on the origin", () => {
        const data = mesh(false, [0, 0])

        const xs = [...data].filter((_, i) => i % MESH_STRIDE === 0)
        expect(Math.min(...xs)).toBeCloseTo(-CELL / 2)
        expect(Math.max(...xs)).toBeCloseTo(CELL / 2)
    })

    it("emits five floats per vertex by default", () => {
        expect(mesh(false, [0, 0]).length % MESH_STRIDE).toBe(0)
        // Two triangles, three vertices each.
        expect(mesh(false, [0, 0]).length / MESH_STRIDE).toBe(6)
    })

    describe("cell centres", () => {
        it("adds two floats per vertex without moving the others", () => {
            const plain = mesh(false, [0, 0])
            const lit = mesh(true, [0, 0])

            expect(lit.length / LIT_MESH_STRIDE).toBe(plain.length / MESH_STRIDE)

            for (let v = 0; v < plain.length / MESH_STRIDE; v++) {
                expect([...lit.slice(v * LIT_MESH_STRIDE, v * LIT_MESH_STRIDE + MESH_STRIDE)])
                    .toEqual([...plain.slice(v * MESH_STRIDE, v * MESH_STRIDE + MESH_STRIDE)])
            }
        })

        it("gives one cell's vertices all the same centre", () => {
            const data = mesh(true, [0, 0])

            for (let i = 0; i < data.length; i += LIT_MESH_STRIDE) {
                // One centred cell: its centre is the origin.
                expect(data[i + 5]).toBeCloseTo(0)
                expect(data[i + 6]).toBeCloseTo(0)
            }
        })

        it("separates neighbouring cells by exactly one cell", () => {
            const data = mesh(true, [0, 0], [1, 0])

            const centres = new Set<string>()
            for (let i = 0; i < data.length; i += LIT_MESH_STRIDE) {
                centres.add(`${data[i + 5].toFixed(4)},${data[i + 6].toFixed(4)}`)
            }

            expect(centres.size).toBe(2)
            const xs = [...centres].map(key => Number(key.split(",")[0])).sort((a, b) => a - b)
            expect(xs[1] - xs[0]).toBeCloseTo(CELL)
        })

        it("puts every centre inside its own cell", () => {
            const grid = buildHull("scytheShip")
            const data = buildGridMesh(grid, CELL, true)

            for (let i = 0; i < data.length; i += LIT_MESH_STRIDE) {
                // Shapes stay inside their cell, so a vertex is never more than
                // half a cell from the centre it reports.
                expect(Math.abs(data[i] - data[i + 5])).toBeLessThanOrEqual(CELL / 2 + 1e-4)
                expect(Math.abs(data[i + 1] - data[i + 6])).toBeLessThanOrEqual(CELL / 2 + 1e-4)
            }
        })

        it("counts one distinct centre per occupied cell", () => {
            const grid = buildHull("firstShip")
            const data = buildGridMesh(grid, CELL, true)

            const centres = new Set<string>()
            for (let i = 0; i < data.length; i += LIT_MESH_STRIDE) {
                centres.add(`${data[i + 5]},${data[i + 6]}`)
            }

            expect(centres.size).toBe(grid.count)
        })
    })
})
