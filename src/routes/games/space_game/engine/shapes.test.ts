import { describe, expect, it } from "vitest"
import { appendShape, type BlockShape } from "./shapes"

/**
 * Specification for the block tessellator.
 *
 * These assert the properties that are invisible on screen: that a shape emits
 * anything at all, that it covers the right area, and that it never escapes its
 * own cell. That last one is load-bearing — grid meshes ignore draw order
 * entirely, which is only safe because cells cannot overlap their neighbours.
 */

const SIZE = 20
const X = 10
const Y = 30

const R = 0.25
const G = 0.5
const B = 0.75

const FLOATS_PER_VERTEX = 5
const TURNS = [0, 1, 2, 3]

/** Every shape that should produce geometry. */
const SOLID_SHAPES: BlockShape[] = ["full", "wedge", "arc"]

interface Vertex {
    x: number
    y: number
    r: number
    g: number
    b: number
}

function build(shape: BlockShape, turns: number): Vertex[] {
    const out: number[] = []
    appendShape(out, shape, turns, X, Y, SIZE, R, G, B)

    expect(out.length % FLOATS_PER_VERTEX).toBe(0)

    const vertices: Vertex[] = []
    for (let i = 0; i < out.length; i += FLOATS_PER_VERTEX) {
        vertices.push({ x: out[i], y: out[i + 1], r: out[i + 2], g: out[i + 3], b: out[i + 4] })
    }
    return vertices
}

/** Summed shoelace area over consecutive vertex triples. */
function area(vertices: Vertex[]): number {
    let total = 0
    for (let i = 0; i + 2 < vertices.length; i += 3) {
        const a = vertices[i]
        const b = vertices[i + 1]
        const c = vertices[i + 2]
        total += Math.abs(
            a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)
        ) / 2
    }
    return total
}

describe("appendShape", () => {
    it("emits nothing for empty", () => {
        for (const turns of TURNS) {
            expect(build("empty", turns)).toHaveLength(0)
        }
    })

    // A missing switch case silently draws nothing, which looks identical to a
    // shape being off screen. This is the cheapest way to catch it.
    it.each(SOLID_SHAPES)("emits geometry for %s at every rotation", (shape) => {
        for (const turns of TURNS) {
            expect(build(shape, turns).length).toBeGreaterThan(0)
        }
    })

    it.each(SOLID_SHAPES)("emits whole triangles for %s", (shape) => {
        for (const turns of TURNS) {
            expect(build(shape, turns).length % 3).toBe(0)
        }
    })

    it.each(SOLID_SHAPES)("carries the given colour on every vertex of %s", (shape) => {
        for (const vertex of build(shape, 0)) {
            expect(vertex.r).toBeCloseTo(R)
            expect(vertex.g).toBeCloseTo(G)
            expect(vertex.b).toBeCloseTo(B)
        }
    })

    // Grid.cells can be reordered freely (by colour, for draw batching) only
    // because no cell overlaps another. This is that guarantee.
    it.each(SOLID_SHAPES)("keeps %s strictly inside its own cell", (shape) => {
        for (const turns of TURNS) {
            for (const vertex of build(shape, turns)) {
                expect(vertex.x).toBeGreaterThanOrEqual(X - 1e-9)
                expect(vertex.x).toBeLessThanOrEqual(X + SIZE + 1e-9)
                expect(vertex.y).toBeGreaterThanOrEqual(Y - 1e-9)
                expect(vertex.y).toBeLessThanOrEqual(Y + SIZE + 1e-9)
            }
        }
    })

    describe("area", () => {
        it("full covers the whole cell", () => {
            expect(area(build("full", 0))).toBeCloseTo(SIZE * SIZE, 6)
        })

        it("wedge covers half the cell", () => {
            expect(area(build("wedge", 0))).toBeCloseTo((SIZE * SIZE) / 2, 6)
        })

        // A quarter disc of radius `size` pinned to a corner: it fills the cell
        // except for a rounded bite out of the opposite corner. Approximated by
        // flat segments, so it lands slightly under the true pi/4, hence the
        // tolerance rather than toBeCloseTo.
        it("arc approximates a quarter disc", () => {
            const expected = (Math.PI * SIZE * SIZE) / 4
            const actual = area(build("arc", 0))

            expect(actual).toBeLessThanOrEqual(expected)
            expect(actual).toBeGreaterThan(expected * 0.97)
        })
    })

    describe("rotation", () => {
        // Rotating a shape moves its vertices but cannot change how much of the
        // cell it covers — a cheap check that the turn maths is a rotation and
        // not an accidental scale or shear.
        it.each(SOLID_SHAPES)("preserves the area of %s across all turns", (shape) => {
            const base = area(build(shape, 0))
            for (const turns of [1, 2, 3]) {
                expect(area(build(shape, turns))).toBeCloseTo(base, 6)
            }
        })

        it("actually moves asymmetric shapes", () => {
            for (const shape of ["wedge", "arc"] as BlockShape[]) {
                const seen = new Set(
                    TURNS.map(turns => JSON.stringify(build(shape, turns).map(v => [v.x, v.y])))
                )
                expect(seen.size).toBe(4)
            }
        })

        it("leaves a full cell unchanged", () => {
            const base = area(build("full", 0))
            expect(area(build("full", 2))).toBeCloseTo(base, 6)
        })

        it("wraps turns beyond a full revolution", () => {
            for (const shape of SOLID_SHAPES) {
                expect(build(shape, 4)).toEqual(build(shape, 0))
                expect(build(shape, 5)).toEqual(build(shape, 1))
            }
        })

        it("handles negative turns", () => {
            for (const shape of SOLID_SHAPES) {
                expect(build(shape, -1)).toEqual(build(shape, 3))
            }
        })
    })
})
