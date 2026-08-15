// Colors in a file: written as hex-keyed entries, read back leniently

import { Color } from "../render/color"

/**
 * Six decimals, and no trailing float noise.
 *
 * A channel converted from hsl comes out as 0.22200000000000003, which is
 * unreadable in a file meant to be hand-edited. Six decimals is still two
 * orders of magnitude finer than the 1/255 a color survives on screen, so this
 * shortens the text without moving the color.
 */
export function round6(value: number): number {
    return Math.round(value * 1e6) / 1e6
}

export const FALLBACK_COLOR = Color.gray(0.6)

export class PaletteWriter {
    private readonly byKey = new Map<string, Color>()

    /**
     * The key for a color, adding it if new.
     *
     * Keys are the color's hex digits rather than c0/c1, so the same color always
     * gets the same name and re-exporting after an unrelated edit produces a
     * stable diff instead of renumbering every entry.
     */
    keyFor(color: Color): string {
        // Color.hex already renders the digits; drop the leading hash
        const base = color.hex.replace("#", "")

        // Two colors can round to the same hex while differing as floats. Suffix
        // instead of letting the second silently overwrite the first.
        for (let attempt = 0; ; attempt++) {
            const key = attempt === 0 ? base : `${base}-${attempt}`
            const existing = this.byKey.get(key)

            if (!existing) {
                this.byKey.set(key, color)
                return key
            }
            if (existing.equals(color)) return key
        }
    }

    toJson(): Record<string, readonly number[]> {
        // Sorted so the palette does not reshuffle between exports. Written as
        // plain triples because JSON has no idea what a Color is.
        return Object.fromEntries(
            [...this.byKey]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, color]) => [key, color.rgb.map(round6)]),
        )
    }
}

export function readPalette(raw: unknown, warnings: string[]): Map<string, Color> {
    const palette = new Map<string, Color>()
    if (raw == null || typeof raw !== "object") return palette

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (
            !Array.isArray(value) ||
            value.length !== 3 ||
            !value.every((channel) => typeof channel === "number" && Number.isFinite(channel))
        ) {
            warnings.push(`palette "${key}" is not three numbers, ignored`)
            continue
        }
        palette.set(key, Color.rgb(value[0], value[1], value[2]))
    }

    return palette
}

/** Formats a palette as one entry per line, for a writer building text by hand. */
export function paletteLines(palette: Record<string, readonly number[]>): string {
    const entries = Object.entries(palette).map(
        ([key, color]) => `    ${JSON.stringify(key)}: [${color.join(", ")}]`,
    )
    return entries.length === 0 ? "{}" : `{\n${entries.join(",\n")}\n  }`
}