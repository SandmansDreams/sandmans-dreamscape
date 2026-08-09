import { describe, expect, it } from "vitest"
import { Camera } from "./camera"

describe("Camera.pack()", () => {
    it("maps world +y to negative clip y, so +y is down the screen", () => {
        const packed = new Camera().pack(800, 600)
        const [m00, m01, m10, m11] = packed

        // clip.y for world (0, 100)
        expect(m11! * 100).toBeLessThan(0)
        // clip.x for world (100, 0)
        expect(m00! * 100).toBeGreaterThan(0)
        // No rotation, so the off-diagonal terms are zero
        expect(m01).toBeCloseTo(0)
        expect(m10).toBeCloseTo(0)
    })

    it("puts one world unit on one pixel at zoom 1", () => {
        const packed = new Camera().pack(800, 600)
        expect(packed[0]).toBeCloseTo(2 / 800)
        expect(packed[3]).toBeCloseTo(-2 / 600)
    })

    it("translates so the camera position lands at the origin of clip space", () => {
        const packed = new Camera({ x: 50, y: 25 }, 1, 0).pack(800, 600)
        const [m00, m01, m10, m11, tx, ty] = packed

        expect(m00! * 50 + m10! * 25 + tx!).toBeCloseTo(0)
        expect(m01! * 50 + m11! * 25 + ty!).toBeCloseTo(0)
    })

    it("carries the viewport in zw", () => {
        const packed = new Camera().pack(800, 600)
        expect(packed[6]).toBe(800)
        expect(packed[7]).toBe(600)
    })

    it("keeps world squares square under rotation", () => {
        const width = 800
        const height = 450 // deliberately not square: that is what exposes a mixed-up scale
        const zoom = 1.5
        const [m00, m01, m10, m11] = new Camera({ x: 0, y: 0 }, zoom, 0.8).pack(width, height)

        // Clip -> pixels scales x by width/2 and y by -height/2 (clip y is up, pixels down).
        // A correct camera makes that composite a pure rotation scaled by zoom, so its two
        // columns must be perpendicular and both exactly `zoom` long.
        const columnX = [m00! * width / 2, -m01! * height / 2]
        const columnY = [m10! * width / 2, -m11! * height / 2]

        expect(Math.hypot(columnX[0]!, columnX[1]!)).toBeCloseTo(zoom)
        expect(Math.hypot(columnY[0]!, columnY[1]!)).toBeCloseTo(zoom)
        expect(columnX[0]! * columnY[0]! + columnX[1]! * columnY[1]!).toBeCloseTo(0)
    })

    it("survives a zero zoom instead of collapsing every vertex", () => {
        const packed = new Camera({ x: 0, y: 0 }, 0).pack(800, 600)
        expect(Number.isFinite(packed[0])).toBe(true)
        expect(packed[0]).not.toBe(0)
    })
})

describe("Camera coordinate conversion", () => {
    it("round-trips screen -> world -> screen with rotation and zoom", () => {
        const camera = new Camera({ x: 120, y: -40 }, 2.5, 0.7)
        camera.pack(800, 600) // caches the viewport the converters read

        const world = camera.screenToWorld(310, 190)
        const screen = camera.worldToScreen(world.x, world.y)

        expect(screen.x).toBeCloseTo(310)
        expect(screen.y).toBeCloseTo(190)
    })

    it("maps the viewport centre to the camera position", () => {
        const camera = new Camera({ x: 120, y: -40 }, 2.5, 0.7)
        camera.pack(800, 600)

        const world = camera.screenToWorld(400, 300)
        expect(world.x).toBeCloseTo(120)
        expect(world.y).toBeCloseTo(-40)
    })
})