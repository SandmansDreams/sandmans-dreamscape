// The glow an emissive cell throws onto the plates around it

import { Color } from "../render/color"
import { cellKey, type Grid } from "../render/grid/grid"

/**
 * How far a cell's glow carries, in cells. Nothing past this gets any.
 *
 * Short on purpose. This is spill onto the neighbours, not a lamp lighting the
 * hull: past about three cells it stops reading as "that strip is glowing" and
 * starts reading as a ship that happens to be blue.
 */
const SPILL_RANGE = 3

/** How much of its colour a fully emissive cell gives to the cell beside it. */
const SPILL_STRENGTH = 0.16

/**
 * How much of a source's glow reaches a cell `distanceSquared` away.
 *
 * Compact rather than inverse-square: it hits exactly zero at SPILL_RANGE, so a
 * plate at the far end of the hull gets *nothing* instead of a faint wash. The
 * first version of this used the same soft inverse-square curve as Light.reach
 * and lit all 138 cells of the Scooner, which is precisely the whole-ship cast
 * this was meant to replace. Squared so it eases out rather than ending on an
 * edge.
 */
export function falloff(distanceSquared: number, rangeSquared: number): number {
    const t = 1 - distanceSquared / rangeSquared
    return t <= 0 ? 0 : t * t
}

/** One cell that lights itself, reduced to what its neighbours need to know. */
export interface EmissiveSource {
    col: number
    row: number
    color: Color
    /** 0..1. */
    emission: number
}

/** Per-cell glow for ONE grid, keyed the way that grid keys its cells. */
export type SpillMap = ReadonlyMap<number, Color>

/** Every cell that lights itself, across whichever layers are passed in. */
export function emissiveSources(grids: readonly Grid[]): EmissiveSource[] {
    const sources: EmissiveSource[] = []

    for (const grid of grids) {
        for (const cell of grid.list) {
            if (cell.emission <= 0) continue

            sources.push({
                col: cell.col,
                row: cell.row,
                color: cell.color,
                emission: Math.min(cell.emission, 1),
            })
        }
    }

    return sources
}

/**
 * How much light each cell of one layer picks up from the emissive cells on the ship.
 *
 * Static per hull, which is the whole reason this can be baked into the mesh
 * rather than sampled every frame: an emissive cell never moves relative to the
 * ship it is on and never changes colour, so the only thing that varies at draw
 * time is one brightness scalar the shader applies.
 *
 * Falls off the way Light.reach does - inverse square with a soft core - so a
 * strip and a lamp agree about what "range" means.
 *
 * Per grid rather than per ship because two layers can hold a cell at the same
 * column and row, and one map over both would have them overwrite each other.
 */
export function spillOnto(grid: Grid, sources: readonly EmissiveSource[]): SpillMap {
    const spill = new Map<number, Color>()
    if (sources.length === 0) return spill

    const rangeSq = SPILL_RANGE * SPILL_RANGE

    for (const cell of grid.list) {
        let red = 0
        let green = 0
        let blue = 0

        for (const source of sources) {
            // A cell is no source for itself: it is already drawn at full
            // brightness by its own emission, and piling its glow on top of that
            // only blows it out
            if (source.col === cell.col && source.row === cell.row) continue

            const dc = source.col - cell.col
            const dr = source.row - cell.row
            const strength = source.emission * SPILL_STRENGTH
                * falloff(dc * dc + dr * dr, rangeSq)
            if (strength <= 0) continue

            red += source.color.r * strength
            green += source.color.g * strength
            blue += source.color.b * strength
        }

        if (red + green + blue <= 0) continue

        // Clamped, because a cell wedged between several strips would otherwise
        // ask for more light than a colour can carry
        spill.set(cellKey(cell.col, cell.row), Color.rgb(
            Math.min(red, 1),
            Math.min(green, 1),
            Math.min(blue, 1),
        ))
    }

    return spill
}