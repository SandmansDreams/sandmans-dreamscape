import { describe, expect, it } from "vitest"
import { Color } from "./color"

describe("Color parsing", () => {
    it("reads long, short and alpha hex, with or without the hash", () => {
        expect(Color.hex("#ff8800").bytes).toEqual([255, 136, 0, 255])
        expect(Color.hex("f80").bytes).toEqual([255, 136, 0, 255])
        expect(Color.hex("#ff880080").bytes).toEqual([255, 136, 0, 128])
    })

    it("returns null rather than throwing for junk", () => {
        expect(Color.parse("nope")).toBeNull()
        expect(Color.parse("#12345")).toBeNull()
        expect(Color.parse(42)).toBeNull()
    })

    it("clamps out-of-range channels instead of passing them to the GPU", () => {
        expect(Color.rgb(2, -1, 0.5).rgb).toEqual([1, 0, 0.5])
        expect(Color.rgb(NaN, 0, 0).r).toBe(0)
    })
})

describe("Color conversion", () => {
    it("round-trips hex", () => {
        expect(Color.hex("#3f7ac2").hex).toBe("#3f7ac2")
    })

    it("round-trips hsl for a saturated color", () => {
        const { h, s, l } = Color.hsl(210, 60, 50).hsl
        expect(h).toBeCloseTo(210)
        expect(s).toBeCloseTo(60)
        expect(l).toBeCloseTo(50)
    })

    it("reports no hue for a gray, because there is none to report", () => {
        // The hue you built it with is genuinely not recoverable
        expect(Color.hsl(210, 0, 50).hsl.h).toBe(0)
    })

    it("wraps a hue past a full turn", () => {
        expect(Color.hsl(370, 100, 50).equals(Color.hsl(10, 100, 50))).toBe(true)
        expect(Color.hsl(-10, 100, 50).equals(Color.hsl(350, 100, 50))).toBe(true)
    })

    it("agrees with hsv on a known color", () => {
        const { h, s, v } = Color.hex("#ff8800").hsv
        expect(h).toBeCloseTo(32, 0)
        expect(s).toBeCloseTo(100)
        expect(v).toBeCloseTo(100)
    })

    it("emits hex when opaque and rgb() when not", () => {
        expect(Color.hex("#112233").css).toBe("#112233")
        expect(Color.rgb(0, 0, 0, 0.5).css).toBe("rgb(0 0 0 / 0.5)")
    })
})

describe("Color mixing", () => {
    it("goes gray through the middle in RGB for complementary colors", () => {
        // Red and cyan cancel channel for channel, which is the case where an RGB
        // blend genuinely loses all its chroma
        const middle = Color.hex("#ff0000").mix(Color.hex("#00ffff"), 0.5)
        expect(middle.hsl.s).toBeCloseTo(0)
    })

    it("darkens through the middle in RGB, where HSL holds its lightness", () => {
        // The real reason a health ramp wants mixHsl: green to red in RGB passes
        // through a muddy half-lit olive, not through amber
        const rgb = Color.hsl(120, 100, 50).mix(Color.hsl(0, 100, 50), 0.5)
        const hsl = Color.hsl(120, 100, 50).mixHsl(Color.hsl(0, 100, 50), 0.5)

        expect(rgb.hsl.l).toBeCloseTo(25)
        expect(hsl.hsl.l).toBeCloseTo(50)
    })

    it("keeps its chroma through the middle in HSL", () => {
        const middle = Color.hsl(120, 100, 50).mixHsl(Color.hsl(0, 100, 50), 0.5)
        expect(middle.hsl.h).toBeCloseTo(60) // amber, not gray
        expect(middle.hsl.s).toBeCloseTo(100)
    })

    it("takes the shorter arc around the circle", () => {
        // 350 to 10 should cross zero, not travel 340 degrees backwards
        expect(Color.hsl(350, 100, 50).mixHsl(Color.hsl(10, 100, 50), 0.5).hsl.h).toBeCloseTo(0)
    })
})