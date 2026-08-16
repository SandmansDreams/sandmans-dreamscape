import { describe, expect, it } from "vitest"
import { layerFor } from "./brush"

describe("layerFor", () => {
    it("keeps a layer the type is allowed on", () => {
        expect(layerFor("hull-plate", "hull")).toBe("hull")
        expect(layerFor("crate", "components")).toBe("components")
    })

    it("keeps the second legal layer rather than snapping to the first", () => {
        // A hull block is allowed on both, so choosing to build cosmetics has to
        // survive a reload
        expect(layerFor("hull-plate", "cosmetic")).toBe("cosmetic")
    })

    it("moves a type off a layer it cannot go on", () => {
        // The pair a stored brush lands in: layer falls back to hull, type does not
        expect(layerFor("crate", "hull")).toBe("components")
        expect(layerFor("autocannon", "cosmetic")).toBe("components")
    })

    it("puts structure back on the hull", () => {
        expect(layerFor("hull-plate", "components")).toBe("hull")
    })
})
