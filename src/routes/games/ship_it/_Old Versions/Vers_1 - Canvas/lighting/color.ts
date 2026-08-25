// Colour parsing and interning for the lighting engine.
//
// Shading runs per cell per entity per frame, so nothing in here is allowed to
// re-parse a CSS colour in the hot path. Callers intern a colour string once
// (usually when a cell is written) and pass the resulting integer id around.

export interface RGB {
    r: number
    g: number
    b: number
}

const HEX_RE = /^#?[0-9a-fA-F]{3,8}$/

const parseCache = new Map<string, RGB>()

/** Parses any CSS colour we actually use into 0-255 RGB. Results are cached. */
export function parseColor(css: string): RGB {
    const cached = parseCache.get(css)
    if (cached) return cached

    const parsed = parseUncached(css)
    parseCache.set(css, parsed)
    return parsed
}

function parseUncached(css: string): RGB {
    const value = css.trim()

    if (value.startsWith("#") || HEX_RE.test(value)) {
        const hex = parseHex(value)
        if (hex) return hex
    }

    if (value.startsWith("rgb")) {
        const parts = numbersIn(value)
        if (parts.length >= 3) {
            return { r: clamp255(parts[0]), g: clamp255(parts[1]), b: clamp255(parts[2]) }
        }
    }

    if (value.startsWith("hsl")) {
        const parts = numbersIn(value)
        if (parts.length >= 3) {
            return hslToRgb(parts[0], parts[1] / 100, parts[2] / 100)
        }
    }

    return namedToRgb(value)
}

function parseHex(value: string): RGB | null {
    const hex = value.startsWith("#") ? value.slice(1) : value

    if (hex.length === 3 || hex.length === 4) {
        return {
            r: parseInt(hex[0] + hex[0], 16),
            g: parseInt(hex[1] + hex[1], 16),
            b: parseInt(hex[2] + hex[2], 16)
        }
    }

    if (hex.length === 6 || hex.length === 8) {
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        }
    }

    return null
}

function numbersIn(value: string): number[] {
    const matches = value.match(/-?\d*\.?\d+/g)
    return matches ? matches.map(Number) : []
}

/**
 * Named colours ("grey", "red", ...) have no cheap parse, so they go through a
 * 1x1 canvas readback. parseColor caches the result, and only a handful of
 * named colours are ever used, so this stays a startup cost.
 */
let scratchCtx: CanvasRenderingContext2D | null = null

function namedToRgb(name: string): RGB {
    if (typeof document === "undefined") return { r: 128, g: 128, b: 128 }

    if (!scratchCtx) {
        const canvas = document.createElement("canvas")
        canvas.width = 1
        canvas.height = 1
        scratchCtx = canvas.getContext("2d", { willReadFrequently: true })
    }
    if (!scratchCtx) return { r: 128, g: 128, b: 128 }

    scratchCtx.clearRect(0, 0, 1, 1)
    scratchCtx.fillStyle = "#000"
    scratchCtx.fillStyle = name
    scratchCtx.fillRect(0, 0, 1, 1)

    const [r, g, b] = scratchCtx.getImageData(0, 0, 1, 1).data
    return { r, g, b }
}

export function hslToRgb(h: number, s: number, l: number): RGB {
    const hue = ((h % 360) + 360) % 360

    if (s <= 0) {
        const v = clamp255(l * 255)
        return { r: v, g: v, b: v }
    }

    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
    const m = l - c / 2

    let r = 0, g = 0, b = 0
    if (hue < 60) { r = c; g = x }
    else if (hue < 120) { r = x; g = c }
    else if (hue < 180) { g = c; b = x }
    else if (hue < 240) { g = x; b = c }
    else if (hue < 300) { r = x; b = c }
    else { r = c; b = x }

    return {
        r: clamp255((r + m) * 255),
        g: clamp255((g + m) * 255),
        b: clamp255((b + m) * 255)
    }
}

export function clamp255(value: number): number {
    if (value <= 0) return 0
    if (value >= 255) return 255
    return value | 0
}

// --- Interning ----------------------------------------------------------
//
// Shading is indexed by colour id so the per-cell path never touches a string.

const colorIds = new Map<string, number>()
const colorTable: RGB[] = []

export function internColor(css: string): number {
    const existing = colorIds.get(css)
    if (existing !== undefined) return existing

    const id = colorTable.length
    colorTable.push(parseColor(css))
    colorIds.set(css, id)
    return id
}

export function colorById(id: number): RGB {
    return colorTable[id] ?? { r: 128, g: 128, b: 128 }
}

export function internedColorCount(): number {
    return colorTable.length
}

export function rgbToCss(r: number, g: number, b: number): string {
    return `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`
}
