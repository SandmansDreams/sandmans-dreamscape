// One color type. Every other representation converts through it.

export interface Hsl {
    /** Degrees, 0-360. */
    h: number
    /** Percent, 0-100. */
    s: number
    /** Percent, 0-100. */
    l: number
    a: number
}

export interface Hsv {
    h: number
    s: number
    /** Percent, 0-100. */
    v: number
    a: number
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/** Wraps into 0-360 so a hue can be animated past a full turn or run negative. */
function wrapHue(degrees: number): number {
    return ((degrees % 360) + 360) % 360
}

export type ColorLike =
    | Color
    | string
    | readonly number[]
    | { r: number; g: number; b: number; a?: number }
    | { h: number; s: number; l: number; a?: number }

/**
 * An immutable RGBA color, stored as 0-1 floats.
 *
 * No gamma conversion anywhere: the shaders use vertex color exactly as written
 * and the hand-authored palettes hold plain sRGB fractions, so linearizing here
 * would silently darken every hull.
 *
 * r/g/b/a are plain readonly fields rather than getters because MeshBuilder
 * reads them once per vertex - a direct property read stays monomorphic.
 */
export class Color {
    readonly r: number
    readonly g: number
    readonly b: number
    readonly a: number

    private constructor(r: number, g: number, b: number, a: number) {
        // Clamped on the way in: an out-of-range channel is never deliberate and
        // would reach the GPU as undefined behavior rather than an obvious bug
        this.r = clamp01(r)
        this.g = clamp01(g)
        this.b = clamp01(b)
        this.a = clamp01(a)
    }

    /*~~~ Building ~~~*/

    /** Channels as 0-1 floats, the renderer's native form. */
    static rgb(r: number, g: number, b: number, a = 1): Color {
        return new Color(r, g, b, a)
    }

    /** Channels as 0-255 bytes. */
    static bytes(r: number, g: number, b: number, a = 255): Color {
        return new Color(r / 255, g / 255, b / 255, a / 255)
    }

    static gray(value: number, a = 1): Color {
        return new Color(value, value, value, a)
    }

    /**
     * "#rgb", "#rrggbb" or "#rrggbbaa", with or without the hash.
     *
     * @throws on anything else. Use `Color.parse` for values a user typed.
     */
    static hex(text: string): Color {
        const parsed = Color.parse(text)
        if (!parsed) throw new Error(`"${text}" is not a hex color`)
        return parsed
    }

    /** Lenient hex parse for untrusted input. Null rather than a throw. */
    static parse(text: unknown): Color | null {
        if (typeof text !== "string") return null

        const clean = text.trim().replace(/^#/, "")
        const expand = clean.length === 3 || clean.length === 4
            ? clean.replace(/./g, (digit) => digit + digit)
            : clean

        if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(expand)) return null

        const byte = (at: number) => Number.parseInt(expand.slice(at, at + 2), 16)
        return Color.bytes(byte(0), byte(2), byte(4), expand.length === 8 ? byte(6) : 255)
    }

    /** Hue in degrees, saturation and lightness as percentages. */
    static hsl(h: number, s: number, l: number, a = 1): Color {
        const hue = wrapHue(h) / 360
        const sat = clamp01(s / 100)
        const light = clamp01(l / 100)

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

    /** Hue in degrees, saturation and value as percentages. */
    static hsv(h: number, s: number, v: number, a = 1): Color {
        const sat = clamp01(s / 100)
        const value = clamp01(v / 100)

        // Convert to HSL and reuse the one implementation
        const light = value * (1 - sat / 2)
        const lightSat = light === 0 || light === 1 ? 0 : (value - light) / Math.min(light, 1 - light)

        return Color.hsl(h, lightSat * 100, light * 100, a)
    }

    /*~~~ Reading ~~~*/

    /** The triple the mesh path and the JSON palette want. */
    get rgb(): readonly [number, number, number] {
        return [this.r, this.g, this.b]
    }

    /** [r, g, b, a], for a render pass clearValue. */
    get gpu(): GPUColor {
        return [this.r, this.g, this.b, this.a]
    }

    get bytes(): readonly [number, number, number, number] {
        return [
            Math.round(this.r * 255),
            Math.round(this.g * 255),
            Math.round(this.b * 255),
            Math.round(this.a * 255),
        ]
    }

    /** "#rrggbb", or "#rrggbbaa" when not fully opaque. */
    get hex(): string {
        const [r, g, b, a] = this.bytes
        const pair = (value: number) => value.toString(16).padStart(2, "0")

        return `#${pair(r)}${pair(g)}${pair(b)}${this.a === 1 ? "" : pair(a)}`
    }

    /**
     * Hue is 0 for any gray, because an achromatic color has no hue to report.
     * Round-tripping hsl -> rgb -> hsl therefore loses the hue you started with
     * whenever saturation is 0 - that information is genuinely not in the color.
     */
    get hsl(): Hsl {
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

    get hsv(): Hsv {
        const max = Math.max(this.r, this.g, this.b)
        const delta = max - Math.min(this.r, this.g, this.b)

        return {
            h: this.hsl.h,
            s: (max === 0 ? 0 : delta / max) * 100,
            v: max * 100,
            a: this.a,
        }
    }

    /** Hex when opaque, rgb() with alpha otherwise. Both are valid CSS. */
    get css(): string {
        if (this.a === 1) return this.hex

        const [r, g, b] = this.bytes
        return `rgb(${r} ${g} ${b} / ${this.a})`
    }

    /*~~~ Deriving ~~~*/

    withAlpha(a: number): Color {
        return new Color(this.r, this.g, this.b, a)
    }

    /** Same hue and saturation, lightness moved by `percent` points. */
    lighten(percent: number): Color {
        const { h, s, l, a } = this.hsl
        return Color.hsl(h, s, l + percent, a)
    }

    /**
     * Linear blend in RGB.
     *
     * Fine between neighbouring colors, but two complementary colors pass
     * through gray at the midpoint - use mixHsl when you want a ramp that keeps
     * its chroma, like a green-to-red health scale.
     */
    mix(other: Color, t: number): Color {
        const amount = clamp01(t)
        const lerp = (from: number, to: number) => from + (to - from) * amount

        return new Color(
            lerp(this.r, other.r),
            lerp(this.g, other.g),
            lerp(this.b, other.b),
            lerp(this.a, other.a),
        )
    }

    /** Blend around the hue circle by the shorter arc, so green to red goes via amber. */
    mixHsl(other: Color, t: number): Color {
        const amount = clamp01(t)
        const from = this.hsl
        const to = other.hsl

        // Shortest arc: without this, 350 to 10 would travel 340 degrees backwards
        let delta = wrapHue(to.h - from.h)
        if (delta > 180) delta -= 360

        const lerp = (a: number, b: number) => a + (b - a) * amount

        return Color.hsl(
            from.h + delta * amount,
            lerp(from.s, to.s),
            lerp(from.l, to.l),
            lerp(from.a, to.a),
        )
    }

    equals(other: Color): boolean {
        return this.r === other.r && this.g === other.g && this.b === other.b && this.a === other.a
    }

    toString(): string {
        return this.css
    }

    /**
     * Interprets whatever it is given.
     *
     * Idempotent on a Color, so it is safe at a boundary where the value might
     * already be converted. Numeric arrays are read as 0-1 floats, which is what
     * a triple has always meant in this codebase - 0-255 input needs Color.bytes,
     * because [1, 0, 0] is genuinely ambiguous and guessing would be worse than
     * asking.
     *
     * @throws on an unparseable string. Use Color.parse for user input.
     */
    static from(value: ColorLike): Color {
        if (value instanceof Color) return value
        if (typeof value === "string") return Color.hex(value)

        if (Array.isArray(value)) {
            const tuple = value as readonly number[]
            return Color.rgb(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0, tuple[3] ?? 1)
        }

        const object = value as { r?: number; g?: number; b?: number; h?: number; s?: number; l?: number; a?: number }
        return object.r !== undefined
            ? Color.rgb(object.r, object.g ?? 0, object.b ?? 0, object.a ?? 1)
            : Color.hsl(object.h ?? 0, object.s ?? 0, object.l ?? 0, object.a ?? 1)
    }

    static readonly WHITE = Color.gray(1)
    static readonly BLACK = Color.gray(0)
    static readonly TRANSPARENT = Color.rgb(0, 0, 0, 0)
    static readonly FALLBACK = Color.gray(0.5)
}