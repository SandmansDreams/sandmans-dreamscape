import { describe, expect, it } from "vitest"
import { Color } from "../color"
import { bakeRole, compactCells } from "./spriteMesh"
import { appendShape } from "./shapes"
import { FLOATS_PER_VERTEX, MeshBuilder } from "../mesh"
import { coverageOf } from "./sampling.test-utils"
import { ArtGrid, type ArtCell } from "./artGrid"

const GRID = 16

const RED = Color.from("#ff0000")
const BLUE = Color.from("#0000ff")

/** Cells for a filled rectangle, inclusive on both corners. */
function plate(from: [number, number], to: [number, number], color: Color): ArtCell[] {
    const grid = new ArtGrid()
    grid.fill(from[0], from[1], to[0], to[1], "full", { color })
    return [...grid.list]
}

function triangleCount(data: Float32Array): number {
    return data.length / (FLOATS_PER_VERTEX * 3)
}

describe("compactCells", () => {
    it("merges a solid plate into one rectangle", () => {
        const rects = compactCells(plate([0, 0], [GRID - 1, GRID - 1], RED))

        expect(rects).toHaveLength(1)
        expect(rects[0]).toMatchObject({ col: 0, row: 0, col2: GRID - 1, row2: GRID - 1 })
    })

    it("never merges across a colour seam", () => {
        const left = plate([0, 0], [7, GRID - 1], RED)
        const right = plate([8, 0], [GRID - 1, GRID - 1], BLUE)

        const rects = compactCells([...left, ...right])
        expect(rects).toHaveLength(2)
    })

    it("splits an L into two rectangles rather than one", () => {
        // (0,0) (1,0)
        // (0,1)
        const grid = new ArtGrid()
        grid.fill(0, 0, 1, 0, "full", { color: RED })
        grid.set(0, 1, "full", { color: RED })

        const rects = compactCells([...grid.list])
        expect(rects).toHaveLength(2)
    })

    it("leaves a shape that is not `full` on its own", () => {
        const grid = new ArtGrid()
        // Two identical arcs side by side would merge if the rule were only
        // "same signature" - they are not rectangles, so they must not
        grid.set(0, 0, "arc", { color: RED })
        grid.set(1, 0, "arc", { color: RED })

        expect(compactCells([...grid.list])).toHaveLength(2)
    })
})

describe("bakeRole", () => {
    it("bakes a solid 16x16 to two triangles", () => {
        expect(triangleCount(bakeRole(plate([0, 0], [15, 15], RED), GRID))).toBe(2)
    })

    it("bakes a two-colour 16x16 to four", () => {
        const cells = [...plate([0, 0], [7, 15], RED), ...plate([8, 0], [15, 15], BLUE)]
        expect(triangleCount(bakeRole(cells, GRID))).toBe(4)
    })

    it("puts the art in unit-cell space", () => {
        const data = bakeRole(plate([0, 0], [15, 15], RED), GRID)

        // Every x and y of a full-canvas plate is 0 or 1, whatever the grid size
        for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) {
            expect([0, 1]).toContain(data[i])
            expect([0, 1]).toContain(data[i + 1])
        }
    })

    it("keeps an arc's own triangles", () => {
        const grid = new ArtGrid()
        grid.set(0, 0, "arc", { color: RED })

        const scratch = new MeshBuilder()
        appendShape(scratch, "arc", 0, false, 0, 0, 1 / GRID, RED)

        expect(triangleCount(bakeRole([...grid.list], GRID)))
            .toBe(triangleCount(scratch.toArray()))
    })
})

describe("bakeRole coverage", () => {
    it("covers exactly what the unmerged triangles covered", () => {
        // Two adjoining plates of different colours, so the merge has both a run
        // to collapse and a seam it must not cross
        const cells = [
            ...plate([2, 2], [9, 9], RED),
            ...plate([10, 2], [13, 9], BLUE),
        ]

        // The same cells with no merging at all - one quad each
        const naive = new MeshBuilder()
        for (const cell of cells) {
            appendShape(naive, "full", 0, false, cell.col / GRID, cell.row / GRID, 1 / GRID, cell.color)
        }

        // 64 samples across the unit box is four per cell, enough that losing a
        // single block would change the bitmap
        expect(coverageOf(bakeRole(cells, GRID), 1, 64))
            .toBe(coverageOf(naive.toArray(), 1, 64))
    })

    it("notices when a merge would swallow a gap", () => {
        // A hole in the middle: if compaction ever merged across it, the baked
        // coverage would gain a block the naive version does not have
        const grid = new ArtGrid()
        grid.fill(0, 0, 4, 4, "full", { color: RED })
        grid.delete(2, 2)

        const cells = [...grid.list]
        const naive = new MeshBuilder()
        for (const cell of cells) {
            appendShape(naive, "full", 0, false, cell.col / GRID, cell.row / GRID, 1 / GRID, cell.color)
        }

        expect(coverageOf(bakeRole(cells, GRID), 1, 64))
            .toBe(coverageOf(naive.toArray(), 1, 64))
    })
})