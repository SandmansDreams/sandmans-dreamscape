import { hexToRgb } from "../color"
import type { RGB } from "../grid"
import { HULL_FORMAT_VERSION, type HullCell, type HullData } from "../hull"
import {
    ARC_BITE, HALF_FILLS, QUARTER_IN, RAMP_ON, WEDGE_SOLID,
    type BlockShape
} from "../shapes"

/**
 * Converts ships authored in the old Canvas2D editor into the current hull
 * format.
 *
 * The two formats disagree in three ways: the old one bakes direction into the
 * shape name (`triSE`, `arcNW`), carries a hex string on every cell rather than
 * a palette key, and writes every cell out individually.
 *
 * Pure and I/O-free so the mapping can be verified in a spec — see
 * `convertHull.ts` for the command-line wrapper.
 */

export interface LegacyCell {
    r: number
    c: number
    s: string
    color?: string
    /** Turrets, thrusters and spikes. Dropped: the new engine has no notion of them yet. */
    placement?: unknown
}

export interface LegacyHull {
    version?: number
    cells?: LegacyCell[]
    /** Spikes attached to empty cells. Dropped, as above. */
    attachments?: unknown[]
}

interface Orientation {
    s: BlockShape
    t: number
    m?: boolean
}

/**
 * Legacy shape name to new shape and orientation.
 *
 * Derived by reading the two renderers against each other, not by eye. The one
 * place they genuinely disagree is the arc: the old name says which corner the
 * quarter disc is *pinned to*, the new `turns` says which corner the rounded
 * bite is *taken out of*, and those are opposites.
 */
export const LEGACY_SHAPES: Readonly<Record<string, Orientation>> = {
    full: { s: "full", t: 0 },

    // The old wedge keeps its named corner; so does the new one.
    triNW: { s: "wedge", t: WEDGE_SOLID.NW },
    triNE: { s: "wedge", t: WEDGE_SOLID.NE },
    triSE: { s: "wedge", t: WEDGE_SOLID.SE },
    triSW: { s: "wedge", t: WEDGE_SOLID.SW },

    // Pinned corner to opposite bite.
    arcNW: { s: "arc", t: ARC_BITE.SE },
    arcNE: { s: "arc", t: ARC_BITE.SW },
    arcSE: { s: "arc", t: ARC_BITE.NW },
    arcSW: { s: "arc", t: ARC_BITE.NE },

    halfN: { s: "half", t: HALF_FILLS.N },
    halfE: { s: "half", t: HALF_FILLS.E },
    halfS: { s: "half", t: HALF_FILLS.S },
    halfW: { s: "half", t: HALF_FILLS.W },

    quarterNW: { s: "quarter", t: QUARTER_IN.NW },
    quarterNE: { s: "quarter", t: QUARTER_IN.NE },
    quarterSE: { s: "quarter", t: QUARTER_IN.SE },
    quarterSW: { s: "quarter", t: QUARTER_IN.SW },

    // The eight legacy ramps are four turns times a mirror. `ramp<Base><Tall>`
    // names the edge it rests on and the end it rises to; `turns` places the
    // base edge and the mirror swaps which end is tall.
    rampNW: { s: "halfWedge", t: RAMP_ON.N },
    rampEN: { s: "halfWedge", t: RAMP_ON.E },
    rampSE: { s: "halfWedge", t: RAMP_ON.S },
    rampWS: { s: "halfWedge", t: RAMP_ON.W },
    rampNE: { s: "halfWedge", t: RAMP_ON.N, m: true },
    rampES: { s: "halfWedge", t: RAMP_ON.E, m: true },
    rampSW: { s: "halfWedge", t: RAMP_ON.S, m: true },
    rampWN: { s: "halfWedge", t: RAMP_ON.W, m: true },
}

/** Hue in degrees, plus the saturation and lightness used to name greys. */
function describe(rgb: RGB): { hue: number, chroma: number, lightness: number } {
    const [r, g, b] = rgb
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min

    let hue = 0
    if (chroma > 0) {
        if (max === r) hue = ((g - b) / chroma + 6) % 6
        else if (max === g) hue = (b - r) / chroma + 2
        else hue = (r - g) / chroma + 4
        hue *= 60
    }

    return { hue, chroma, lightness: (max + min) / 2 }
}

const HUE_NAMES: readonly (readonly [number, string])[] = [
    [15, "red"], [45, "orange"], [70, "yellow"], [165, "green"],
    [195, "cyan"], [255, "blue"], [285, "indigo"], [315, "violet"],
    [345, "pink"], [360, "red"],
]

/**
 * A name for a colour, from the colour itself.
 *
 * Deterministic and readable without pretending to know which grey is "hull"
 * and which is "trim" — that judgement belongs to whoever edits the file next,
 * and renaming a palette key is a one-line change.
 */
function colorFamily(rgb: RGB): string {
    const { hue, chroma, lightness } = describe(rgb)

    if (chroma < 0.08) {
        if (lightness > 0.9) return "white"
        if (lightness < 0.1) return "black"
        return "grey"
    }

    return HUE_NAMES.find(([limit]) => hue < limit)?.[1] ?? "red"
}

/**
 * Names every distinct colour, numbering within a family from light to dark.
 *
 * Returns the palette and a lookup from the original hex.
 */
function buildPalette(hexes: Iterable<string>): {
    palette: Record<string, RGB>
    keyOf: Map<string, string>
} {
    const entries = [...new Set(hexes)].map(hex => {
        const rgb = hexToRgb(hex)
        return { hex, rgb, family: colorFamily(rgb), lightness: describe(rgb).lightness }
    })

    const palette: Record<string, RGB> = {}
    const keyOf = new Map<string, string>()

    const families = new Map<string, typeof entries>()
    for (const entry of entries) {
        const group = families.get(entry.family) ?? []
        group.push(entry)
        families.set(entry.family, group)
    }

    for (const [family, group] of families) {
        group.sort((a, b) => b.lightness - a.lightness)

        for (const [index, entry] of group.entries()) {
            // A family with one member reads better unnumbered.
            const key = group.length === 1 ? family : `${family}${index + 1}`
            palette[key] = entry.rgb
            keyOf.set(entry.hex, key)
        }
    }

    return { palette, keyOf }
}

interface Placed {
    c: number
    r: number
    s: BlockShape
    t: number
    m: boolean
    p?: string
}

/** Everything that has to match for two cells to merge into one entry. */
function signature(cell: Placed): string {
    return `${cell.s}|${cell.t}|${cell.m}|${cell.p ?? ""}`
}

/**
 * Merges identical neighbours into rectangles.
 *
 * Horizontal runs first, then vertically adjacent runs that cover exactly the
 * same columns. Hull interiors are long stretches of `full`, so this roughly
 * halves a file — which is the difference between a hull you can read and one
 * you scroll past.
 */
function compact(cells: Placed[]): HullCell[] {
    const byRow = new Map<number, Placed[]>()
    for (const cell of cells) {
        const row = byRow.get(cell.r) ?? []
        row.push(cell)
        byRow.set(cell.r, row)
    }

    interface Span extends Placed { c2: number }
    const spans: Span[] = []

    for (const row of byRow.values()) {
        row.sort((a, b) => a.c - b.c)

        let run: Span | null = null
        for (const cell of row) {
            if (run && run.c2 + 1 === cell.c && signature(run) === signature(cell)) {
                run.c2 = cell.c
            } else {
                run = { ...cell, c2: cell.c }
                spans.push(run)
            }
        }
    }

    // Stack spans covering the same columns down consecutive rows.
    const stacks = new Map<string, Span[]>()
    for (const span of spans) {
        const key = `${span.c}|${span.c2}|${signature(span)}`
        const stack = stacks.get(key) ?? []
        stack.push(span)
        stacks.set(key, stack)
    }

    const out: HullCell[] = []

    for (const stack of stacks.values()) {
        stack.sort((a, b) => a.r - b.r)

        let start = 0
        for (let i = 1; i <= stack.length; i++) {
            if (i < stack.length && stack[i].r === stack[i - 1].r + 1) continue

            const first = stack[start]
            const last = stack[i - 1]

            const entry: HullCell = { c: first.c, r: first.r, s: first.s }
            if (first.c2 !== first.c) entry.c2 = first.c2
            if (last.r !== first.r) entry.r2 = last.r
            if (first.t !== 0) entry.t = first.t
            if (first.m) entry.m = true
            if (first.p !== undefined) entry.p = first.p

            out.push(entry)
            start = i
        }
    }

    return out.sort((a, b) => a.r - b.r || a.c - b.c)
}

export interface ConvertResult {
    hull: HullData
    warnings: string[]
    /** Cells before compaction, for reporting how much the rectangles saved. */
    cellCount: number
}

/**
 * Converts a legacy hull.
 *
 * Lenient in the same way `loadHullDetailed` is: an unrecognised shape or a
 * malformed colour costs that one cell, not the ship. Placements and
 * attachments are dropped entirely.
 */
export function convertLegacyHull(data: LegacyHull, name?: string): ConvertResult {
    const warnings: string[] = []

    if (!data || !Array.isArray(data.cells)) {
        return {
            hull: { version: HULL_FORMAT_VERSION, name, palette: {}, cells: [] },
            warnings: ["legacy hull has no `cells` array"],
            cellCount: 0
        }
    }

    const usable: { cell: LegacyCell, orientation: Orientation }[] = []

    data.cells.forEach((cell, index) => {
        const orientation = LEGACY_SHAPES[cell.s]
        if (!orientation) {
            warnings.push(`cell ${index}: unknown legacy shape "${cell.s}"`)
            return
        }
        usable.push({ cell, orientation })
    })

    const hexes: string[] = []
    for (const { cell } of usable) {
        if (cell.color === undefined) continue
        try {
            hexToRgb(cell.color)
            hexes.push(cell.color)
        } catch {
            // Named below, once, rather than per cell that uses it.
        }
    }

    const { palette, keyOf } = buildPalette(hexes)

    const placed: Placed[] = []

    for (const { cell, orientation } of usable) {
        let key: string | undefined
        if (cell.color !== undefined) {
            key = keyOf.get(cell.color)
            if (key === undefined) {
                warnings.push(`cell (${cell.c}, ${cell.r}): unreadable colour "${cell.color}"`)
            }
        }

        placed.push({
            c: cell.c,
            r: cell.r,
            s: orientation.s,
            t: orientation.t,
            m: orientation.m ?? false,
            p: key
        })
    }

    if (data.attachments?.length) {
        warnings.push(`dropped ${data.attachments.length} attachment(s)`)
    }

    const withPlacements = data.cells.filter(cell => cell.placement !== undefined).length
    if (withPlacements > 0) {
        warnings.push(`dropped ${withPlacements} placement(s)`)
    }

    return {
        hull: {
            version: HULL_FORMAT_VERSION,
            name,
            palette,
            cells: compact(placed)
        },
        warnings,
        cellCount: placed.length
    }
}
