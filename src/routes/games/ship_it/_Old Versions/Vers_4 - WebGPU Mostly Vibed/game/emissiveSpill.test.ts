import { describe, expect, it } from "vitest"
import { Color } from "../render/color"
import { cellKey, Grid } from "../render/grid/grid"
import { emissiveSources, spillOnto } from "./emissiveSpill"

const CYAN = Color.rgb(0, 0.8, 1)

/** A row of plain cells, with emission set on whichever columns are named. */
function row(length: number, lit: number[] = []): Grid {
    const grid = new Grid("hull")

    for (let col = 0; col < length; col++) {
        grid.set(col, 0, "full", {
            color: lit.includes(col) ? CYAN : Color.gray(0.5),
            emission: lit.includes(col) ? 1 : 0,
        })
    }

    return grid
}

function at(grid: Grid, sources: ReturnType<typeof emissiveSources>, col: number): Color | undefined {
    return spillOnto(grid, sources).get(cellKey(col, 0))
}

describe("sources", () => {
    it("finds only the cells that light themselves", () => {
        const grid = row(4, [1])
        expect(emissiveSources([grid])).toHaveLength(1)
        expect(emissiveSources([row(4)])).toHaveLength(0)
    })
})

describe("spill", () => {
    it("lights the cell next door", () => {
        const grid = row(4, [1])
        const glow = at(grid, emissiveSources([grid]), 0)

        expect(glow).toBeDefined()
        expect(glow!.b).toBeGreaterThan(0)
    })

    it("falls off with distance", () => {
        const grid = row(8, [0])
        const sources = emissiveSources([grid])

        expect(at(grid, sources, 1)!.b).toBeGreaterThan(at(grid, sources, 2)!.b)
        expect(at(grid, sources, 2)!.b).toBeGreaterThan(0)
    })

    it("gives nothing at all past its range", () => {
        // The failure this guards: a soft inverse-square curve never quite
        // reaches zero, so every plate on the ship picked up a faint wash and
        // the result read as a blue hull rather than a glowing strip
        const grid = row(8, [0])
        const sources = emissiveSources([grid])

        expect(at(grid, sources, 3)).toBeUndefined()
        expect(at(grid, sources, 6)).toBeUndefined()
    })

    it("takes the source's colour, not a fixed one", () => {
        const grid = row(4, [1])
        const glow = at(grid, emissiveSources([grid]), 0)!

        // Cyan is (0, 0.8, 1), so blue leads, green follows and red is absent
        expect(glow.b).toBeGreaterThan(glow.g)
        expect(glow.g).toBeGreaterThan(glow.r)
        expect(glow.r).toBe(0)
    })

    it("gives an emissive cell no glow from itself", () => {
        // One lit cell alone: it is the only source, and it must not light itself
        const grid = row(1, [0])
        expect(at(grid, emissiveSources([grid]), 0)).toBeUndefined()
    })

    it("sums two sources", () => {
        const one = row(5, [0])
        const two = row(5, [0, 4])

        expect(at(two, emissiveSources([two]), 2)!.b)
            .toBeGreaterThan(at(one, emissiveSources([one]), 2)!.b)
    })

    it("never asks for more light than a colour can carry", () => {
        const grid = row(9, [0, 1, 2, 3, 5, 6, 7, 8])
        const glow = at(grid, emissiveSources([grid]), 4)!

        expect(glow.b).toBeLessThanOrEqual(1)
        expect(glow.g).toBeLessThanOrEqual(1)
    })

    it("is empty when nothing on the ship glows", () => {
        const grid = row(4)
        expect(spillOnto(grid, emissiveSources([grid])).size).toBe(0)
    })
})