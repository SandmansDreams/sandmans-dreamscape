import type { RGB } from "./grid"

/**
 * Colour conversion.
 *
 * Hex is the format everything outside the renderer speaks — hull files, the
 * settings file, and `<input type="color">` — while the shaders want 0..1
 * floats. This is the one place that bridges them.
 */

/**
 * `#rrggbb` or `#rgb` to a 0..1 triple, rounded to three decimals.
 *
 * No gamma conversion: the shader uses vertex colour as written, and the
 * hand-authored palettes already hold plain sRGB fractions. Rounding keeps
 * generated files readable at a cost of well under one 8-bit step.
 *
 * @throws if the string is not a hex colour. Callers that accept user input
 *         should catch — a half-typed value is not worth breaking on.
 */
export function hexToRgb(hex: string): RGB {
    const raw = hex.trim().replace(/^#/, "")

    const expanded = raw.length === 3
        ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
        : raw

    const value = Number.parseInt(expanded, 16)
    if (expanded.length !== 6 || Number.isNaN(value)) {
        throw new Error(`not a hex colour: "${hex}"`)
    }

    const channel = (shift: number) =>
        Math.round(((value >> shift) & 0xff) / 255 * 1000) / 1000

    return [channel(16), channel(8), channel(0)]
}

/** True if the string is a colour `hexToRgb` will accept. */
export function isHexColor(value: unknown): value is string {
    if (typeof value !== "string") return false

    try {
        hexToRgb(value)
        return true
    } catch {
        return false
    }
}
