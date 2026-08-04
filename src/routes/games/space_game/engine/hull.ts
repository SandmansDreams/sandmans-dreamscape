import { Grid, type RGB } from "./grid"
import { BLOCK_SHAPES, type BlockShape } from "./shapes"

/**
 * The on-disk hull format.
 *
 * Two departures from a naive dump of the cell list, both aimed at files a
 * human can still read:
 *
 *   - Colours live in a palette and cells reference them by name, so
 *     recolouring a ship is one edit rather than one per cell.
 *   - A cell may carry `c2`/`r2` to mean an inclusive rectangle. Hull interiors
 *     are mostly runs of `full`, so this roughly halves a typical file.
 *
 * Keys are short because these files get long.
 */

export const HULL_FORMAT_VERSION = 1

/**
 * Shapes and palette entries are typed loosely rather than as `BlockShape` and
 * `RGB`, because JSON cannot express a string literal union or a fixed-length
 * tuple — a hand-edited file can contain anything. Validation lives in
 * `loadHullDetailed`, which is where a bad value can be reported usefully.
 */
export interface HullCell {
    /** Column, and optionally the far column of an inclusive rectangle. */
    c: number
    c2?: number
    /** Row, and optionally the far row. */
    r: number
    r2?: number
    s: string
    /** Quarter-turns clockwise. Defaults to 0. */
    t?: number
    /** Mirrored. Defaults to false. */
    m?: boolean
    /** Palette key. Falls back to the grid default when missing. */
    p?: string
}

export interface HullData {
    version: number
    /** Display label. Falls back to the filename when absent. */
    name?: string
    /** Values are RGB triples in 0..1. */
    palette: Record<string, readonly number[]>
    cells: HullCell[]
}

const KNOWN_SHAPES: ReadonlySet<string> = new Set(BLOCK_SHAPES)

export interface LoadHullResult {
    grid: Grid
    /** Anything the file asked for that could not be honoured. */
    warnings: string[]
}

/**
 * Builds a Grid from hull data.
 *
 * Deliberately lenient: an unknown shape or a missing palette key drops that
 * one cell rather than throwing, so a hand-edited or older file loses a block
 * instead of the whole ship. What was dropped comes back in `warnings`.
 */
export function loadHullDetailed(data: HullData): LoadHullResult {
    const grid = new Grid()
    const warnings: string[] = []

    if (!data || !Array.isArray(data.cells)) {
        return { grid, warnings: ["hull has no `cells` array"] }
    }

    const palette = data.palette ?? {}

    data.cells.forEach((cell, index) => {
        if (!KNOWN_SHAPES.has(cell.s)) {
            warnings.push(`cell ${index}: unknown shape "${cell.s}"`)
            return
        }

        let color: RGB | undefined
        if (cell.p !== undefined) {
            const entry = palette[cell.p]
            if (!entry) {
                warnings.push(`cell ${index}: palette has no entry "${cell.p}"`)
                return
            }
            if (entry.length < 3) {
                warnings.push(`cell ${index}: palette entry "${cell.p}" is not an RGB triple`)
                return
            }
            color = [entry[0], entry[1], entry[2]]
        }

        const options = { turns: cell.t ?? 0, mirrored: cell.m ?? false, color }

        // A cell is a rectangle when it names a far corner, otherwise a point.
        grid.fill(
            cell.c, cell.r,
            cell.c2 ?? cell.c, cell.r2 ?? cell.r,
            cell.s as BlockShape,
            options
        )
    })

    return { grid, warnings }
}

/** As above, logging any warnings rather than returning them. */
export function loadHull(data: HullData, label = "hull"): Grid {
    const { grid, warnings } = loadHullDetailed(data)

    for (const warning of warnings) {
        console.warn(`${label}: ${warning}`)
    }

    return grid
}

/**
 * Serialises a Grid.
 *
 * Colours are matched back to the palette by value; anything unmatched gets an
 * entry of its own so nothing is silently lost. No attempt is made to find
 * rectangles — that is the editor's job if it wants smaller files, and cells
 * written one at a time still round-trip identically.
 */
export function saveHull(grid: Grid, palette: Record<string, RGB> = {}): HullData {
    const named = Object.entries(palette)
    const used: Record<string, RGB> = {}
    const cells: HullCell[] = []

    let generated = 0

    for (const cell of grid.list) {
        const match = named.find(([, rgb]) =>
            rgb[0] === cell.r && rgb[1] === cell.g && rgb[2] === cell.b
        )

        let key: string
        if (match) {
            key = match[0]
        } else {
            key = `color${generated++}`
            named.push([key, [cell.r, cell.g, cell.b]])
        }

        used[key] = used[key] ?? [cell.r, cell.g, cell.b]

        const entry: HullCell = { c: cell.col, r: cell.row, s: cell.shape, p: key }
        if (cell.turns !== 0) entry.t = cell.turns
        if (cell.mirrored) entry.m = true

        cells.push(entry)
    }

    return { version: HULL_FORMAT_VERSION, palette: used, cells }
}
