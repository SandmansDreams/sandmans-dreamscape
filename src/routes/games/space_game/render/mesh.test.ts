import { describe, expect, it } from "vitest"
import { grownCapacity } from "./mesh"

/*
 * DynamicMesh itself needs a device, so only its growth policy is testable here.
 * That is the part with a decision in it; the rest is Mesh.create and update.
 */
describe("grownCapacity", () => {
    it("fits data that a doubling would not reach", () => {
        expect(grownCapacity(10, 100)).toBe(100)
    })

    it("doubles rather than fitting exactly, so a creeping mesh stops reallocating", () => {
        // The bug this pins: a mesh that grows by one triangle a frame would
        // reallocate every frame if capacity only ever fit the data
        expect(grownCapacity(100, 105)).toBe(200)
    })

    it("grows from nothing to exactly what is asked for", () => {
        expect(grownCapacity(0, 45)).toBe(45)
    })

    it("never shrinks below what is needed", () => {
        for (const [current, needed] of [[0, 5], [5, 5], [50, 1], [7, 999]] as const) {
            expect(grownCapacity(current, needed)).toBeGreaterThanOrEqual(needed)
        }
    })
})
