import { describe, expect, it } from "vitest"
import { Grid } from "./grid"

describe("Grid keying", () => {
    it("keeps negative coordinates distinct", () => {
        const grid = new Grid()
        grid.set(-1, -1, "full")
        grid.set(1, 1, "half")
        grid.set(-1, 1, "wedge")
        grid.set(1, -1, "arc")

        expect(grid.size).toBe(4)
        expect(grid.get(-1, -1)?.shape).toBe("full")
        expect(grid.get(1, 1)?.shape).toBe("half")
        expect(grid.get(-1, 1)?.shape).toBe("wedge")
        expect(grid.get(1, -1)?.shape).toBe("arc")
    })

    it("does not collide across the packing boundary", () => {
        // (1, 0) and (0, 65536) would collide under a naive col * 65536 + row
        const grid = new Grid()
        grid.set(1, 0, "full")
        grid.set(0, 0, "half")
        expect(grid.size).toBe(2)
    })

    it("rejects a cell outside the packable range", () => {
        expect(() => new Grid().set(40000, 0, "full")).toThrow()
    })
})

describe("Grid.fill()", () => {
    it("is inclusive on both corners", () => {
        const grid = new Grid()
        grid.fill(0, 0, 2, 0, "full")
        expect(grid.size).toBe(3)
    })

    it("tolerates reversed corners", () => {
        const grid = new Grid()
        grid.fill(2, 2, 0, 0, "full")
        expect(grid.size).toBe(9)
    })
})

describe("Grid bounds and center", () => {
    it("reports null bounds and a zero center when empty", () => {
        const grid = new Grid()
        expect(grid.bounds).toBeNull()
        expect(grid.center).toEqual({ x: 0, y: 0 })
        expect(grid.extent).toEqual({ width: 0, height: 0 })
    })

    it("centers a single cell at 0.5, not 0", () => {
        // Bounds are inclusive indices: the cell at column 0 spans 0 to 1
        const grid = new Grid()
        grid.set(0, 0, "full")
        expect(grid.center).toEqual({ x: 0.5, y: 0.5 })
        expect(grid.extent).toEqual({ width: 1, height: 1 })
    })

    it("centers a symmetric hull on the origin", () => {
        const grid = new Grid()
        grid.fill(-2, -2, 1, 1, "full")
        expect(grid.center).toEqual({ x: 0, y: 0 })
        expect(grid.extent).toEqual({ width: 4, height: 4 })
    })
})

describe("Grid revisions", () => {
    it("bumps both counters when geometry changes", () => {
        const grid = new Grid()
        const revision = grid.revision
        const geometry = grid.geometryRevision

        grid.set(0, 0, "full")

        expect(grid.revision).toBeGreaterThan(revision)
        expect(grid.geometryRevision).toBeGreaterThan(geometry)
    })

    it("bumps only the data counter on damage, so the mesh is not rebuilt", () => {
        const grid = new Grid()
        grid.set(0, 0, "full")

        const revision = grid.revision
        const geometry = grid.geometryRevision

        grid.damage(0, 0, 5)

        expect(grid.revision).toBeGreaterThan(revision)
        expect(grid.geometryRevision).toBe(geometry)
    })

    it("bumps both when a cell is deleted", () => {
        const grid = new Grid()
        grid.set(0, 0, "full")
        const geometry = grid.geometryRevision

        grid.delete(0, 0)
        expect(grid.geometryRevision).toBeGreaterThan(geometry)
    })

    it("does not bump anything for a delete that removed nothing", () => {
        const grid = new Grid()
        const revision = grid.revision
        expect(grid.delete(5, 5)).toBe(false)
        expect(grid.revision).toBe(revision)
    })
})

describe("Grid components", () => {
    it("takes hit points and mass from the kind's level", () => {
        const grid = new Grid()
        const cell = grid.set(0, 0, "full", { kind: "generator", level: 2 })
        expect(cell.hitPoints).toBe(20)
        expect(cell.mass).toBe(5)
    })

    it("clamps a level past what the kind has", () => {
        const grid = new Grid()
        const cell = grid.set(0, 0, "full", { kind: "storage", level: 99 })
        expect(cell.hitPoints).toBe(12) // storage tops out at level 2
    })

    it("lets a cell override the level's defaults", () => {
        const grid = new Grid()
        const cell = grid.set(0, 0, "full", { kind: "hull", hitPoints: 999 })
        expect(cell.hitPoints).toBe(999)
        expect(cell.mass).toBe(1) // untouched
    })

    it("gives cosmetic blocks no mass, whatever the caller asks for", () => {
        const grid = new Grid("cosmetic")
        const cell = grid.set(0, 0, "full", { kind: "hull", mass: 50 })
        expect(cell.mass).toBe(0)
        expect(grid.mass).toBe(0)
    })

    it("indexes cells by kind and reindexes after a change", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { kind: "thruster" })
        grid.set(1, 0, "full", { kind: "thruster" })
        grid.set(2, 0, "full", { kind: "weapon" })

        expect(grid.ofKind("thruster")).toHaveLength(2)
        expect(grid.ofKind("weapon")).toHaveLength(1)

        grid.delete(0, 0)
        expect(grid.ofKind("thruster")).toHaveLength(1)
    })
})

describe("Grid.centerOfMass", () => {
    it("matches the bounds center when mass is uniform", () => {
        const grid = new Grid()
        grid.fill(-1, 0, 0, 0, "full")
        expect(grid.centerOfMass).toEqual({ x: 0, y: 0.5 })
    })

    it("pulls toward the heavy end", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { kind: "hull" })       // mass 1, center x 0.5
        grid.set(3, 0, "full", { kind: "generator" })  // mass 3, center x 3.5

        // (0.5*1 + 3.5*3) / 4 = 2.75, well right of the bounds center at 2
        expect(grid.centerOfMass.x).toBeCloseTo(2.75)
        expect(grid.center.x).toBe(2)
    })

    it("falls back to the bounds center when nothing has mass", () => {
        const grid = new Grid("cosmetic")
        grid.set(4, 4, "full")
        expect(grid.centerOfMass).toEqual(grid.center)
    })
})

describe("Grid.centerOfMass", () => {
    it("matches the bounds center when mass is uniform", () => {
        const grid = new Grid()
        grid.fill(-1, 0, 0, 0, "full")
        expect(grid.centerOfMass).toEqual({ x: 0, y: 0.5 })
    })

    it("pulls toward the heavy end", () => {
        const grid = new Grid()
        grid.set(0, 0, "full", { kind: "hull" })       // mass 1, center x 0.5
        grid.set(3, 0, "full", { kind: "generator" })  // mass 3, center x 3.5

        // (0.5*1 + 3.5*3) / 4 = 2.75, well right of the bounds center at 2
        expect(grid.centerOfMass.x).toBeCloseTo(2.75)
        expect(grid.center.x).toBe(2)
    })

    it("falls back to the bounds center when nothing has mass", () => {
        const grid = new Grid("cosmetic")
        grid.set(4, 4, "full")
        expect(grid.centerOfMass).toEqual(grid.center)
    })
})