import { describe, expect, it } from "vitest"
import { wrapText, distributeSlack } from "./font"

// One unit per character, so maxWidth reads as a column count in these tests
const measure = (line: string) => line.length

describe("wrapText()", () => {
    it("breaks between words rather than inside them", () => {
        expect(wrapText("the quick brown fox", 10, measure)).toBe("the quick\nbrown fox")
    })

    it("leaves text that already fits alone", () => {
        expect(wrapText("short", 10, measure)).toBe("short")
    })

    it("keeps explicit newlines", () => {
        expect(wrapText("one\ntwo", 10, measure)).toBe("one\ntwo")
    })

    it("keeps deliberate blank lines", () => {
        expect(wrapText("a\n\nb", 10, measure)).toBe("a\n\nb")
    })

    it("hard-breaks a word too long for any line", () => {
        expect(wrapText("supercalifragilistic", 8, measure)).toBe("supercal\nifragili\nstic")
    })

    it("wraps before hard-breaking, so a long word starts on its own line", () => {
        expect(wrapText("hi supercalifragilistic", 8, measure)).toBe("hi\nsupercal\nifragili\nstic")
    })

    it("terminates when a single character is wider than the whole line", () => {
        // Every character measures 2 against a width of 1, so nothing can ever fit
        const wide = (line: string) => line.length * 2
        expect(wrapText("abc", 1, wide)).toBe("a\nb\nc")
    })

    it("returns the text unchanged for a non-positive width", () => {
        expect(wrapText("the quick brown fox", 0, measure)).toBe("the quick brown fox")
    })
})

describe("distributeSlack()", () => {
    it("spreads the remainder across the leading gaps", () => {
        expect(distributeSlack(7, 3)).toEqual({ perGap: 2, wideGaps: 1 })
    })

    it("divides evenly when it can", () => {
        expect(distributeSlack(6, 3)).toEqual({ perGap: 2, wideGaps: 0 })
    })

    it("gives every gap one when there is less slack than gaps", () => {
        expect(distributeSlack(2, 5)).toEqual({ perGap: 0, wideGaps: 2 })
    })

    it("does nothing for a line with no gaps or no slack", () => {
        expect(distributeSlack(10, 0)).toEqual({ perGap: 0, wideGaps: 0 })
        expect(distributeSlack(0, 4)).toEqual({ perGap: 0, wideGaps: 0 })
    })
})