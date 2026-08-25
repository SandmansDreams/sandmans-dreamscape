import { describe, expect, it } from "vitest"
import { Color } from "../color"
import { appendShape, BLOCK_SHAPES, MIRRORABLE_SHAPES, shapeCovers, turnCount, type BlockShape } from "./shapes"
import { FLOATS_PER_VERTEX, MeshBuilder } from "../mesh"
import { coverageOf as coverageOfMesh } from "./sampling.test-utils"

const DRAWN = BLOCK_SHAPES.filter((shape) => shape !== "empty")

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

/**
 * The area a shape covers, as a sampled bitmap.
 *
 * A thin wrapper: the sampling itself is shared with the sprite bake tests,
 * which compare a merged mesh against an unmerged one for the same reason.
 */
function coverageOf(shape: BlockShape, turns: number, mirrored = false, size = 40): string {
    const builder = new MeshBuilder()
    appendShape(builder, shape, turns, mirrored, 0, 0, size, Color.WHITE)
    return coverageOfMesh(builder.toArray(), size)
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
describe("shapeCovers", () => {
    it("covers the whole cell for a full block", () => {
        for (const [u, v] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]] as const) {
            expect(shapeCovers("full", 0, false, u, v)).toBe(true)
        }
    })

    it("covers nothing at all for empty", () => {
        expect(shapeCovers("empty", 0, false, 0.5, 0.5)).toBe(false)
    })

    it("leaves the other half of a half block uncovered", () => {
        // The whole point of the hit test: a half block has real gaps, and a click
        // in one should reach whatever is drawn underneath
        const top = shapeCovers("half", 0, false, 0.5, 0.2)
        const bottom = shapeCovers("half", 0, false, 0.5, 0.8)

        expect(top).not.toBe(bottom)
    })

    it("follows the shape round its turns", () => {
        // Turning a half block moves which half is solid, so the same point flips
        const before = shapeCovers("half", 0, false, 0.5, 0.2)
        const after = shapeCovers("half", 2, false, 0.5, 0.2)

        expect(before).not.toBe(after)
    })

    it("misses the empty corner of a wedge and hits the solid one", () => {
        const hits = [[0.1, 0.1], [0.9, 0.9], [0.1, 0.9], [0.9, 0.1]]
            .map(([u, v]) => shapeCovers("wedge", 0, false, u!, v!))

        // A wedge fills a triangle, so some corners are in and some are out
        expect(hits).toContain(true)
        expect(hits).toContain(false)
    })
})
