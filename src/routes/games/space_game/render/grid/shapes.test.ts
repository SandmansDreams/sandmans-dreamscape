import { describe, expect, it } from "vitest"
import { Color } from "../color"
import { appendShape, BLOCK_SHAPES, MIRRORABLE_SHAPES, turnCount, type BlockShape } from "./shapes"
import { FLOATS_PER_VERTEX, MeshBuilder } from "../mesh"

const DRAWN = BLOCK_SHAPES.filter((shape) => shape !== "empty")

const SAMPLES = 24

/*
 * Sample offsets, deliberately different per axis and off any neat fraction.
 *
 * A point exactly on an edge is inside or outside by float rounding, and
 * mirroring reverses the winding, which flips that tie. Offsetting both axes by
 * the SAME amount does not help: the diamond's edges are x - y = +-20, and a
 * uniform offset cancels in x - y, leaving the samples right back on the line.
 */
const OFFSET_X = 0.3183
const OFFSET_Y = 0.5171

/** The vertex positions a shape emits, as [x, y] pairs. */
function positionsOf(shape: BlockShape, turns: number, mirrored = false, size = 40): number[][] {
    const builder = new MeshBuilder()
    appendShape(builder, shape, turns, mirrored, 0, 0, size, Color.WHITE)

    const data = builder.toArray()
    const points: number[][] = []
    for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) points.push([data[i]!, data[i + 1]!])
    return points
}

/** -0 and 0 stringify differently, and the fan shapes come out of cos/sin. */
function round(n: number): string {
    return (Number(n.toFixed(6)) + 0).toString()
}

function cross(x: number, y: number, from: number[], to: number[]): number {
    return (x - to[0]!) * (from[1]! - to[1]!) - (from[0]! - to[0]!) * (y - to[1]!)
}

function inTriangle(x: number, y: number, a: number[], b: number[], c: number[]): boolean {
    const d1 = cross(x, y, a, b)
    const d2 = cross(x, y, b, c)
    const d3 = cross(x, y, c, a)

    // A consistent sign means inside. Winding may be either way after a mirror,
    // so both all-negative and all-positive count.
    const negative = d1 < 0 || d2 < 0 || d3 < 0
    const positive = d1 > 0 || d2 > 0 || d3 > 0
    return !(negative && positive)
}

/**
 * The area a shape covers, as a sampled bitmap.
 *
 * Compares the figure rather than the triangles: mirroring re-splits a quad
 * along the opposite diagonal, so two identical rectangles can be built from
 * completely different triangle pairs.
 */
function coverageOf(shape: BlockShape, turns: number, mirrored = false, size = 40): string {
    const points = positionsOf(shape, turns, mirrored, size)
    let bitmap = ""

    for (let row = 0; row < SAMPLES; row++) {
        for (let column = 0; column < SAMPLES; column++) {
            const x = ((column + OFFSET_X) / SAMPLES) * size
            const y = ((row + OFFSET_Y) / SAMPLES) * size

            let inside = false
            for (let i = 0; i < points.length && !inside; i += 3) {
                inside = inTriangle(x, y, points[i]!, points[i + 1]!, points[i + 2]!)
            }
            bitmap += inside ? "#" : "."
        }
    }

    return bitmap
}


describe("appendShape()", () => {
    it("emits nothing for empty", () => {
        expect(positionsOf("empty", 0)).toHaveLength(0)
    })

    it("emits whole triangles for every shape at every turn", () => {
        for (const shape of DRAWN) {
            for (let turns = 0; turns < 4; turns++) {
                expect(positionsOf(shape, turns).length % 3, `${shape} @ ${turns}`).toBe(0)
            }
        }
    })

    it("keeps every vertex inside the cell", () => {
        for (const shape of DRAWN) {
            for (let turns = 0; turns < 4; turns++) {
                for (const [x, y] of positionsOf(shape, turns)) {
                    expect(x, `${shape} @ ${turns}`).toBeGreaterThanOrEqual(-1e-9)
                    expect(x, `${shape} @ ${turns}`).toBeLessThanOrEqual(40 + 1e-9)
                    expect(y, `${shape} @ ${turns}`).toBeGreaterThanOrEqual(-1e-9)
                    expect(y, `${shape} @ ${turns}`).toBeLessThanOrEqual(40 + 1e-9)
                }
            }
        }
    })

    it("rotates exactly, so cell-boundary vertices stay bit-identical", () => {
        // This is the crack-free property: `full` covers the cell, and after any
        // rotation its corners must land on exactly 0 and 40 with no float drift
        for (let turns = 0; turns < 4; turns++) {
            for (const [x, y] of positionsOf("full", turns)) {
                expect([0, 40]).toContain(x)
                expect([0, 40]).toContain(y)
            }
        }
    })

    it("makes mirroring redundant for shapes outside MIRRORABLE_SHAPES", () => {
        for (const shape of DRAWN) {
            if (MIRRORABLE_SHAPES.includes(shape)) continue

            const mirrored = coverageOf(shape, 0, true)
            const matchesSomeRotation = [0, 1, 2, 3].some((turns) => coverageOf(shape, turns) === mirrored)
            expect(matchesSomeRotation, `${shape} mirrored should match a rotation`).toBe(true)
        }
    })

    it("makes mirroring distinct for shapes inside MIRRORABLE_SHAPES", () => {
        for (const shape of MIRRORABLE_SHAPES) {
            const mirrored = coverageOf(shape, 0, true)
            const matchesSomeRotation = [0, 1, 2, 3].some((turns) => coverageOf(shape, turns) === mirrored)
            expect(matchesSomeRotation, `${shape} mirrored should NOT match a rotation`).toBe(false)
        }
    })

    it("repeats after its turn count, and not before", () => {
        for (const shape of DRAWN) {
            const count = turnCount(shape)

            // Turn `count` must look like turn 0 again
            expect(coverageOf(shape, count), `${shape} should repeat at ${count}`)
                .toBe(coverageOf(shape, 0))

            // ...and nothing before it may
            for (let turns = 1; turns < count; turns++) {
                expect(coverageOf(shape, turns), `${shape} turn ${turns} should differ from 0`)
                    .not.toBe(coverageOf(shape, 0))
            }
        }
    })
})