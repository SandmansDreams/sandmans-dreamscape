import { describe, expect, it } from "vitest"

import { hexToRgb, isHexColor } from "./color"

describe("hexToRgb", () => {
    it("maps the channel extremes", () => {
        expect(hexToRgb("#ff0000")).toEqual([1, 0, 0])
        expect(hexToRgb("#000000")).toEqual([0, 0, 0])
        expect(hexToRgb("#ffffff")).toEqual([1, 1, 1])
    })

    it("expands the three-digit form", () => {
        expect(hexToRgb("#f80")).toEqual(hexToRgb("#ff8800"))
    })

    it("rounds to three decimals", () => {
        // 0x80 / 255 = 0.50196…
        expect(hexToRgb("#808080")).toEqual([0.502, 0.502, 0.502])
    })

    it("does not need the hash", () => {
        expect(hexToRgb("ff0000")).toEqual([1, 0, 0])
    })

    it("rejects anything that is not a colour", () => {
        expect(() => hexToRgb("#gg0000")).toThrow()
        expect(() => hexToRgb("blue")).toThrow()
        expect(() => hexToRgb("#ff00")).toThrow()
    })
})

describe("isHexColor", () => {
    it("answers without throwing", () => {
        expect(isHexColor("#123456")).toBe(true)
        expect(isHexColor("#abc")).toBe(true)
        expect(isHexColor("rebeccapurple")).toBe(false)
        expect(isHexColor(42)).toBe(false)
        expect(isHexColor(undefined)).toBe(false)
    })
})
