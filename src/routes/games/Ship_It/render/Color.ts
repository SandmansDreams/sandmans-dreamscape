import { clamp } from "../utils"

export type HSL = {
    /** Degrees, 0-360. */
    h: number
    /** Percent, 0-100. */
    s: number
    /** Percent, 0-100. */
    l: number
    /** Float, 0-1. */
    a?: number
}

export type RGB = {
    /** Bytes, 0-255 */
    r: number
    /** Bytes, 0-255 */
    g: number
    /** Bytes, 0-255 */
    b: number
    /** Bytes, 0-255 */
    a?: number
}

export type ColorLike =
    | Color
    | string
    | number[]
    | RGB
    | HSL

/** Turns a number into a portion of a hex string */
export function toHexSegment (value: number) { value.toString(16).padStart(2, "0") }

/** Wraps into 0-360 so a hue can be animated past a full turn or run negative. */
function wrapHue(degrees: number): number { return ((degrees % 360) + 360) % 360 }

/** A color storage and conversion class, defaults to GPUColor Floats as that is what is mainly needed for WebGPU */
export class Color {
    readonly r: number
    readonly g: number
    readonly b: number
    readonly a: number

    private constructor(r: number, g: number, b: number, a: number) {
        this.r = clamp(r, 1)
        this.g = clamp(g, 1)
        this.b = clamp(b, 1)
        this.a = clamp(a, 1)
    }

    /* Building */
    static fromRGBA(r: number, g: number, b: number, a = 1): Color {
        return new Color(r, g, b, a)
    }

    /** Channels as 0-255 bytes. */
    static fromRGBABytes(r: number, g: number, b: number, a = 255): Color {
        return new Color(r / 255, g / 255, b / 255, a / 255)
    }

    static fromHex(text: string): Color {
        const parsed = Color.parse(text)
        if (!parsed) throw new Error(`"${text}" is not a hex color`)
        return parsed
    }

    static fromHSL(h: number, s: number, l: number, a = 1): Color {
        const hue = wrapHue(h) / 360
        const sat = clamp(1, s / 100)
        const light = clamp(1, l / 100)

        if (sat === 0) return new Color(light, light, light, a)

        // Standard HSL: two anchor values, then each channel sampled a third of
        // the way around the hue circle from the others
        const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
        const p = 2 * light - q

        const channel = (t: number): number => {
            const shifted = (t % 1 + 1) % 1
            if (shifted < 1 / 6) return p + (q - p) * 6 * shifted
            if (shifted < 1 / 2) return q
            if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6
            return p
        }

        return new Color(channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3), a)
    }

    static grey(value: number, a = 1): Color {
        return new Color(value, value, value, a)
    }

    static parse(text: unknown): Color | null {
        if (typeof text !== "string") return null

        const clean = text.trim().replace(/^#/, "")
        const expand = clean.length === 3 || clean.length === 4
            ? clean.replace(/./g, (digit) => digit + digit)
            : clean

        if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(expand)) return null

        const byte = (at: number) => Number.parseInt(expand.slice(at, at + 2), 16)
        return Color.fromRGBABytes(byte(0), byte(2), byte(4), expand.length === 8 ? byte(6) : 255)
    }

    /* Reading */
    get gpu(): GPUColor {
        return [this.r, this.g, this.b, this.a]
    }

    get rgb(): RGB {
        return {
            r: Math.round(this.r * 255),
            g: Math.round(this.g * 255),
            b: Math.round(this.b * 255),
            a: Math.round(this.a * 255),
        }
    }

    get rgbArray(): [number, number, number, number] {
        return [
            Math.round(this.r * 255),
            Math.round(this.g * 255),
            Math.round(this.b * 255),
            Math.round(this.a * 255),
        ]
    }

    get hex(): string {
        const [r, g, b, a] = this.rgbArray

        return `#${toHexSegment(r)}${toHexSegment(g)}${toHexSegment(b)}${this.a === 1 ? "" : toHexSegment(a)}`
    }

    get hsl(): HSL {
        const max = Math.max(this.r, this.g, this.b)
        const min = Math.min(this.r, this.g, this.b)
        const delta = max - min
        const l = (max + min) / 2

        if (delta === 0) return { h: 0, s: 0, l: l * 100, a: this.a }

        const s = delta / (1 - Math.abs(2 * l - 1))
        let h: number

        if (max === this.r) h = ((this.g - this.b) / delta) % 6
        else if (max === this.g) h = (this.b - this.r) / delta + 2
        else h = (this.r - this.g) / delta + 4

        return { h: wrapHue(h * 60), s: s * 100, l: l * 100, a: this.a }
    }

    get css(): string {
        if (this.a === 1) return this.hex

        const [r, g, b, a] = this.rgbArray
        return `rgb(${r} ${g} ${b} / ${a})` // Modern css format instead of rgba
    }

    /* Helpers */
    /** Input any non-specific valid format and convert it to a Color */
    static from(value: ColorLike): Color {
        if (value instanceof Color) return value
        if (typeof value === "string") return Color.fromHex(value)

        if (Array.isArray(value)) {
            const tuple = value as readonly number[]
            return Color.fromRGBA(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0, tuple[3] ?? 1)
        }

        const object = value as { r?: number; g?: number; b?: number; h?: number; s?: number; l?: number; a?: number }
        return object.r !== undefined
            ? Color.fromRGBA(object.r, object.g ?? 0, object.b ?? 0, object.a ?? 1)
            : Color.fromHSL(object.h ?? 0, object.s ?? 0, object.l ?? 0, object.a ?? 1)
    }
}