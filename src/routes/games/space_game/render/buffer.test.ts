import { align4 } from "./buffer"
import { describe, expect, it } from "vitest"

describe("align4()", () => {
    it("aligns values to the next multiple of four", () => {
        expect(align4(0)).toBe(0)
        expect(align4(1)).toBe(4)
        expect(align4(2)).toBe(4)
        expect(align4(3)).toBe(4)
        expect(align4(4)).toBe(4)
        expect(align4(5)).toBe(8)
        expect(align4(8)).toBe(8)
        expect(align4(9)).toBe(12)
    })

    it("matches the expected mathematical result", () => {
        for (let bytes = 0; bytes <= 1000; bytes++) {
            expect(align4(bytes)).toBe(Math.ceil(bytes / 4) * 4)
        }
    })
})