import { describe, expect, it } from "vitest"
import { buildShip } from "../assets/ships"
import { Color } from "./color"
import { appendLayer } from "./grid/blockDraw"
import { FLOATS_PER_CELL_VERTEX, grownCapacity, MeshBuilder } from "./mesh"

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

describe("cell indices", () => {
    /**
     * The coupling this guards: the mesh hands each cell an index as it is named,
     * and the flight scene fills a per-cell glow buffer by walking layersOf() and
     * grid.list itself. If those two walks ever disagree, engines light the wrong
     * plates - and nothing else would catch it.
     */
    it("numbers cells in the order appendLayer walks them", () => {
        const ship = buildShip("scooner")
        const layers = ship.layersOf()

        const builder = new MeshBuilder()
        for (const grid of layers) appendLayer(builder, grid, 32, ship.centerOfMass)

        const flat = layers.flatMap((grid) => grid.list)
        expect(builder.cellCount).toBe(flat.length)

        // Every vertex carries its cell's index at .w and its centre at .xy, so
        // the two can be checked against each other
        const cells = builder.toCellArray()
        const com = ship.centerOfMass

        for (let v = 0; v < cells.length / FLOATS_PER_CELL_VERTEX; v++) {
            const at = v * FLOATS_PER_CELL_VERTEX
            const index = cells[at + 3]!
            const cell = flat[index]

            expect(cell).toBeDefined()
            expect(cells[at]).toBeCloseTo((cell!.col + 0.5 - com.x) * 32)
            expect(cells[at + 1]).toBeCloseTo((cell!.row + 0.5 - com.y) * 32)
        }
    })

    it("does not spend an index on geometry outside any cell", () => {
        const builder = new MeshBuilder()
        builder.outsideCell().quad(0, 0, 1, 1, Color.WHITE)

        expect(builder.cellCount).toBe(0)
    })
})
