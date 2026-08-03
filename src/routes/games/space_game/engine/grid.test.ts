import { describe, expect, it } from "vitest"
import { Grid } from "./grid"
import { buildGridMesh, GridMeshCache } from "./gridMesh"

const CELL = 10

describe("Grid", () => {
    it("stores and retrieves cells", () => {
        const grid = new Grid()
        grid.set(2, 3, "full", { turns: 1, mirrored: true, color: [1, 0, 0] })

        const cell = grid.get(2, 3)
        expect(cell).toMatchObject({ col: 2, row: 3, shape: "full", turns: 1, mirrored: true })
        expect(cell!.r).toBe(1)
    })

    it("handles negative coordinates", () => {
        const grid = new Grid()
        grid.set(-5, -7, "full")
        grid.set(5, 7, "wedge")

        expect(grid.get(-5, -7)!.shape).toBe("full")
        expect(grid.get(5, 7)!.shape).toBe("wedge")
        expect(grid.count).toBe(2)
    })

    // The key packs both coordinates into one integer; a collision would
    // silently overwrite an unrelated cell.
    it("keeps distinct coordinates distinct", () => {
        const grid = new Grid()
        const coords: [number, number][] = [
            [0, 0], [0, 1], [1, 0], [-1, 0], [0, -1],
            [-1, -1], [1, -1], [-1, 1], [255, 0], [0, 255], [-255, 255]
        ]

        for (const [col, row] of coords) grid.set(col, row, "full")
        expect(grid.count).toBe(coords.length)
    })

    it("normalises turns on write", () => {
        const grid = new Grid()
        grid.set(0, 0, "wedge", { turns: 5 })
        grid.set(1, 0, "wedge", { turns: -1 })

        expect(grid.get(0, 0)!.turns).toBe(1)
        expect(grid.get(1, 0)!.turns).toBe(3)
    })

    it("treats setting empty as a delete", () => {
        const grid = new Grid()
        grid.set(0, 0, "full")
        grid.set(0, 0, "empty")

        expect(grid.has(0, 0)).toBe(false)
        expect(grid.count).toBe(0)
    })

    it("fills inclusive rectangles regardless of corner order", () => {
        const grid = new Grid()
        grid.fill(3, 3, 1, 1, "full")

        expect(grid.count).toBe(9)
        expect(grid.has(1, 1)).toBe(true)
        expect(grid.has(3, 3)).toBe(true)
    })

    it("reports orthogonal neighbours only", () => {
        const grid = new Grid()
        grid.set(1, 0, "full")

        expect(grid.hasNeighbour(0, 0)).toBe(true)
        expect(grid.hasNeighbour(2, 0)).toBe(true)
        // Diagonal — not a neighbour.
        expect(grid.hasNeighbour(2, 1)).toBe(false)
    })

    describe("revision", () => {
        it("advances on every mutation", () => {
            const grid = new Grid()
            const start = grid.revision

            grid.set(0, 0, "full")
            const afterSet = grid.revision
            expect(afterSet).toBeGreaterThan(start)

            grid.delete(0, 0)
            expect(grid.revision).toBeGreaterThan(afterSet)
        })

        // Otherwise a cached mesh would rebuild for no reason on any frame that
        // happened to probe the grid.
        it("does not advance when deleting a cell that is not there", () => {
            const grid = new Grid()
            grid.set(0, 0, "full")

            const before = grid.revision
            expect(grid.delete(9, 9)).toBe(false)
            expect(grid.revision).toBe(before)
        })

        it("does not advance when clearing an empty grid", () => {
            const grid = new Grid()
            const before = grid.revision
            grid.clear()
            expect(grid.revision).toBe(before)
        })

        it("advances when clearing a populated grid", () => {
            const grid = new Grid()
            grid.set(0, 0, "full")

            const before = grid.revision
            grid.clear()
            expect(grid.revision).toBeGreaterThan(before)
            expect(grid.count).toBe(0)
        })
    })

    describe("bounds and centre", () => {
        it("is empty for an empty grid", () => {
            const grid = new Grid()
            expect(grid.bounds).toBeNull()
            expect(grid.centre).toEqual({ x: 0, y: 0 })
            expect(grid.extent).toEqual({ width: 0, height: 0 })
        })

        it("spans the occupied cells", () => {
            const grid = new Grid()
            grid.set(-2, 1, "full")
            grid.set(3, 5, "full")

            expect(grid.bounds).toEqual({ minCol: -2, maxCol: 3, minRow: 1, maxRow: 5 })
            expect(grid.extent).toEqual({ width: 6, height: 5 })
        })

        // Bounds are inclusive indices, so a single cell at column 0 spans 0..1
        // and its centre is 0.5 — not 0.
        it("centres on the middle of the occupied area", () => {
            const grid = new Grid()
            grid.set(0, 0, "full")
            expect(grid.centre).toEqual({ x: 0.5, y: 0.5 })

            grid.set(1, 0, "full")
            expect(grid.centre).toEqual({ x: 1, y: 0.5 })
        })

        it("recomputes after a mutation", () => {
            const grid = new Grid()
            grid.set(0, 0, "full")
            expect(grid.extent.width).toBe(1)

            grid.set(4, 0, "full")
            expect(grid.extent.width).toBe(5)
        })
    })
})

describe("buildGridMesh", () => {
    function vertices(data: Float32Array) {
        const points: { x: number, y: number }[] = []
        for (let i = 0; i < data.length; i += 5) points.push({ x: data[i], y: data[i + 1] })
        return points
    }

    it("produces nothing for an empty grid", () => {
        expect(buildGridMesh(new Grid(), CELL)).toHaveLength(0)
    })

    it("emits five floats per vertex, three vertices per triangle", () => {
        const grid = new Grid()
        grid.fill(0, 0, 2, 2, "full")

        const mesh = buildGridMesh(grid, CELL)
        expect(mesh.length % 5).toBe(0)
        expect((mesh.length / 5) % 3).toBe(0)
        // Nine cells, two triangles each.
        expect(mesh.length / 5 / 3).toBe(18)
    })

    // The whole point of baking the offset in: an entity drawn at world P has
    // its hull centred on P, with no per-frame translation.
    it("centres the mesh on the grid's centre", () => {
        const grid = new Grid()
        grid.fill(0, 0, 2, 2, "full")

        const points = vertices(buildGridMesh(grid, CELL))
        const xs = points.map(p => p.x)
        const ys = points.map(p => p.y)

        expect(Math.min(...xs)).toBeCloseTo(-1.5 * CELL, 6)
        expect(Math.max(...xs)).toBeCloseTo(1.5 * CELL, 6)
        expect(Math.min(...ys)).toBeCloseTo(-1.5 * CELL, 6)
        expect(Math.max(...ys)).toBeCloseTo(1.5 * CELL, 6)
    })

    it("stays centred for an off-origin grid", () => {
        const grid = new Grid()
        grid.fill(10, -4, 12, -2, "full")

        const points = vertices(buildGridMesh(grid, CELL))
        const xs = points.map(p => p.x)

        expect(Math.min(...xs)).toBeCloseTo(-1.5 * CELL, 6)
        expect(Math.max(...xs)).toBeCloseTo(1.5 * CELL, 6)
    })

    it("carries each cell's own colour", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { color: [1, 0, 0] })
        grid.set(1, 0, "full", { color: [0, 1, 0] })

        const mesh = buildGridMesh(grid, CELL)
        const reds = new Set<string>()
        for (let i = 0; i < mesh.length; i += 5) {
            reds.add(`${mesh[i + 2]},${mesh[i + 3]},${mesh[i + 4]}`)
        }

        expect(reds).toEqual(new Set(["1,0,0", "0,1,0"]))
    })

    it("scales with cell size", () => {
        const grid = new Grid()
        grid.set(0, 0, "full")

        const small = buildGridMesh(grid, 10)
        const large = buildGridMesh(grid, 20)

        expect(large.length).toBe(small.length)
        expect(Math.max(...vertices(large).map(p => p.x)))
            .toBeCloseTo(Math.max(...vertices(small).map(p => p.x)) * 2, 6)
    })
})

describe("GridMeshCache", () => {
    it("builds on first read and then reuses", () => {
        const grid = new Grid()
        grid.set(0, 0, "full")

        const cache = new GridMeshCache(grid, CELL)
        expect(cache.stale).toBe(true)

        const first = cache.vertices
        expect(cache.stale).toBe(false)
        expect(cache.vertices).toBe(first)   // same instance, not rebuilt
    })

    it("rebuilds after the grid changes", () => {
        const grid = new Grid()
        grid.set(0, 0, "full")

        const cache = new GridMeshCache(grid, CELL)
        const first = cache.vertices

        grid.set(1, 0, "full")
        expect(cache.stale).toBe(true)
        expect(cache.vertices).not.toBe(first)
        expect(cache.vertexCount).toBe(12)   // two cells, two triangles each
    })

    it("rebuilds when the cell size changes", () => {
        const grid = new Grid()
        grid.set(0, 0, "full")

        const cache = new GridMeshCache(grid, CELL)
        const first = cache.vertices

        cache.setCellSize(CELL * 2)
        expect(cache.vertices).not.toBe(first)
    })
})
