import { describe, expect, it } from "vitest"
import { appendShape, BLOCK_SHAPES, MIRRORABLE_SHAPES, type BlockShape } from "./shapes"
import { FLOATS_PER_VERTEX, MeshBuilder } from "./mesh"

/** The vertex positions a shape emits, as [x, y] pairs. */
function positionsOf(shape: BlockShape, turns: number, mirrored = false, size = 40): number[][] {
    const builder = new MeshBuilder()
    appendShape(builder, shape, turns, mirrored, 0, 0, size, [1, 1, 1])

    const data = builder.toArray()
    const points: number[][] = []
    for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) points.push([data[i]!, data[i + 1]!])
    return points
}

const DRAWN = BLOCK_SHAPES.filter((shape) => shape !== "empty")

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

    it("normalises turns past a revolution and below zero", () => {
        expect(positionsOf("wedge", 5)).toEqual(positionsOf("wedge", 1))
        expect(positionsOf("wedge", -1)).toEqual(positionsOf("wedge", 3))
    })

    it("makes mirroring redundant for shapes outside MIRRORABLE_SHAPES", () => {
        for (const shape of DRAWN) {
            if (MIRRORABLE_SHAPES.includes(shape)) continue

            const mirrored = positionsOf(shape, 0, true)
            const matchesSomeRotation = [0, 1, 2, 3].some((turns) =>
                JSON.stringify(positionsOf(shape, turns)) === JSON.stringify(mirrored),
            )
            expect(matchesSomeRotation, `${shape} mirrored should match a rotation`).toBe(true)
        }
    })
})