import { describe, expect, it } from "vitest"
import { Color } from "../color"
import { MeshBuilder, FLOATS_PER_VERTEX } from "../mesh"
import { appendBlock, appendLayer, blockCovers, type BlockLike } from "./blockDraw"
import { appendShape } from "./shapes"
import { Grid } from "./grid"

const RED = Color.rgb(1, 0, 0)
const BACKGROUND = Color.rgb(0.05, 0.05, 0.07)

/** One solid red cell, which is the simplest thing with a colour to check. */
function oneRedCell(): Grid {
    const grid = new Grid()
    grid.set(0, 0, "full", { color: RED })
    return grid
}

/** Every vertex's colour, as [r, g, b] triples. */
function colorsOf(builder: MeshBuilder): number[][] {
    const data = builder.toArray()
    const out: number[][] = []

    for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) {
        out.push([data[i + 2]!, data[i + 3]!, data[i + 4]!])
    }

    return out
}

/** The same layer drawn twice, once plain and once faded, vertex for vertex. */
function fadedAgainstPlain(fade: number): { plain: number[][]; faded: number[][] } {
    const plain = new MeshBuilder()
    const faded = new MeshBuilder()

    appendLayer(plain, oneRedCell(), 32, { x: 0, y: 0 })
    appendLayer(faded, oneRedCell(), 32, { x: 0, y: 0 }, fade, BACKGROUND)

    return { plain: colorsOf(plain), faded: colorsOf(faded) }
}

describe("appendLayer fade", () => {
    /*
     * Compared against the unfaded draw rather than against a colour written into
     * the test. A block draws as its component's art, and art carries static
     * squares that keep the shade they were drawn with - so "every vertex is the
     * cell's colour" stopped being true the day the hull plate got art, while
     * "every vertex moved the same fraction toward the background" is the thing
     * the fade actually promises.
     */
    it("draws the authored colour when nothing is faded", () => {
        const { plain, faded } = fadedAgainstPlain(0)

        expect(faded).toEqual(plain)
        // The cell's own colour reaches the vertices it recolours
        expect(plain.some(([r, g, b]) => r === 1 && g === 0 && b === 0)).toBe(true)
    })

    it("lands on the background at full fade", () => {
        const builder = new MeshBuilder()
        appendLayer(builder, oneRedCell(), 32, { x: 0, y: 0 }, 1, BACKGROUND)

        for (const [r, g, b] of colorsOf(builder)) {
            expect(r).toBeCloseTo(BACKGROUND.r)
            expect(g).toBeCloseTo(BACKGROUND.g)
            expect(b).toBeCloseTo(BACKGROUND.b)
        }
    })

    it("keeps 15% of the colour at the dim fade", () => {
        // 0.85 is what the builder's dim state uses, and 15% of the original is
        // what its button promises
        const { plain, faded } = fadedAgainstPlain(0.85)

        expect(faded).toHaveLength(plain.length)

        plain.forEach(([r, g, b], index) => {
            const [fr, fg, fb] = faded[index]!

            expect(fr).toBeCloseTo(r! * 0.15 + BACKGROUND.r * 0.85, 4)
            expect(fg).toBeCloseTo(g! * 0.15 + BACKGROUND.g * 0.85, 4)
            expect(fb).toBeCloseTo(b! * 0.15 + BACKGROUND.b * 0.85, 4)
        })
    })

    it("does not change the geometry it emits", () => {
        const plain = new MeshBuilder()
        const faded = new MeshBuilder()

        appendLayer(plain, oneRedCell(), 32, { x: 0, y: 0 })
        appendLayer(faded, oneRedCell(), 32, { x: 0, y: 0 }, 0.85, BACKGROUND)

        // A fade is a colour, not a shape: hiding a layer is what removes blocks
        expect(faded.vertexCount).toBe(plain.vertexCount)
    })
})

describe("appendLayer art", () => {
    /** A cell wearing a piece of art, which is what the seam is for. */
    function turretGrid(facing = 0): Grid {
        const grid = new Grid("components")
        grid.set(0, 0, "full", { type: "autocannon", level: 1, facing, color: RED })
        return grid
    }

    function bounds(builder: MeshBuilder) {
        const data = builder.toArray()
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

        for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) {
            minX = Math.min(minX, data[i]!)
            maxX = Math.max(maxX, data[i]!)
            minY = Math.min(minY, data[i + 1]!)
            maxY = Math.max(maxY, data[i + 1]!)
        }

        return { minX, minY, maxX, maxY }
    }

    it("draws art for a component and plain geometry for a hull", () => {
        const withArt = new MeshBuilder()
        appendLayer(withArt, turretGrid(), 32, { x: 0, y: 0 })

        const hull = new MeshBuilder()
        appendLayer(hull, oneRedCell(), 32, { x: 0, y: 0 })

        // The turret is a couple of hundred triangles; a full block is two
        expect(withArt.vertexCount).toBeGreaterThan(hull.vertexCount * 3)
    })

    it("never dresses a hull in art, whatever files exist", () => {
        const block: BlockLike = {
            shape: "wedge", turns: 0, mirrored: false,
            type: "hull-plate", facing: 0, level: 1, color: RED, accentColor: null,
        }

        const drawn = new MeshBuilder()
        appendBlock(drawn, block, 0, 0, 32)

        const shape = new MeshBuilder()
        appendShape(shape, "wedge", 0, false, 0, 0, 32, RED)

        // Identical vertex for vertex: a hull is its shape and nothing else, so a
        // hull-plate art file appearing in the folder must change nothing here
        expect([...drawn.toArray()]).toEqual([...shape.toArray()])
    })

    it("keeps the art inside the cell it belongs to", () => {
        const builder = new MeshBuilder()
        appendLayer(builder, turretGrid(), 32, { x: 0, y: 0 })

        const box = bounds(builder)
        expect(box.minX).toBeGreaterThanOrEqual(-0.001)
        expect(box.minY).toBeGreaterThanOrEqual(-0.001)
        expect(box.maxX).toBeLessThanOrEqual(32.001)
        expect(box.maxY).toBeLessThanOrEqual(32.001)
    })

    it("stays inside the cell when rotated", () => {
        for (const facing of [1, 2, 3]) {
            const builder = new MeshBuilder()
            appendLayer(builder, turretGrid(facing), 32, { x: 0, y: 0 })

            const box = bounds(builder)
            expect(box.minX).toBeGreaterThanOrEqual(-0.001)
            expect(box.maxX).toBeLessThanOrEqual(32.001)
            expect(box.minY).toBeGreaterThanOrEqual(-0.001)
            expect(box.maxY).toBeLessThanOrEqual(32.001)
        }
    })

    it("actually moves the geometry when facing changes", () => {
        const north = new MeshBuilder()
        const east = new MeshBuilder()
        appendLayer(north, turretGrid(0), 32, { x: 0, y: 0 })
        appendLayer(east, turretGrid(1), 32, { x: 0, y: 0 })

        // Same triangle count, different positions - one file, four headings
        expect(east.vertexCount).toBe(north.vertexCount)
        expect([...east.toArray()]).not.toEqual([...north.toArray()])
    })

    it("tints the main role with the cell's colour", () => {
        const builder = new MeshBuilder()
        appendLayer(builder, turretGrid(), 32, { x: 0, y: 0 })

        const data = builder.toArray()
        let reds = 0
        for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) {
            if (data[i + 2] === 1 && data[i + 3] === 0 && data[i + 4] === 0) reds++
        }

        expect(reds).toBeGreaterThan(0)
    })
})

describe("preview and placement agree", () => {
    /** What the editor's ghost builds: a block with no coordinates yet. */
    function preview(type: string, level = 1, facing = 0): BlockLike {
        return {
            shape: "full", turns: 0, mirrored: false,
            type, level, facing,
            color: RED, accentColor: null,
        }
    }

    /** The same block, placed. */
    function placed(type: string, level = 1, facing = 0): Grid {
        const grid = new Grid("components")
        grid.set(0, 0, "full", { type, level, facing, color: RED })
        return grid
    }

    // The bug this pins: the ghost drew through its own path and showed a hexagon
    // over a component whose art the ship was already drawing
    it.each([
        ["autocannon", 1],
        ["autocannon", 5],
        ["railgun", 1],
        ["hull-plate", 1],
    ])("%s L%i previews exactly what it places", (type, level) => {
        const ghost = new MeshBuilder()
        const ship = new MeshBuilder()

        appendBlock(ghost, preview(type, level), 0, 0, 32)
        appendLayer(ship, placed(type, level), 32, { x: 0, y: 0 })

        expect([...ghost.toArray()]).toEqual([...ship.toArray()])
    })

    it("previews the rotation it will place", () => {
        const ghost = new MeshBuilder()
        const ship = new MeshBuilder()

        appendBlock(ghost, preview("autocannon", 3, 2), 0, 0, 32)
        appendLayer(ship, placed("autocannon", 3, 2), 32, { x: 0, y: 0 })

        expect([...ghost.toArray()]).toEqual([...ship.toArray()])
    })

    it("previews a level's own art rather than the type's", () => {
        const one = new MeshBuilder()
        const five = new MeshBuilder()

        appendBlock(one, preview("autocannon", 1), 0, 0, 32)
        appendBlock(five, preview("autocannon", 5), 0, 0, 32)

        expect([...one.toArray()]).not.toEqual([...five.toArray()])
    })
})

describe("blockCovers", () => {
    function block(overrides: Partial<BlockLike> = {}): BlockLike {
        return {
            shape: "full", turns: 0, mirrored: false,
            type: "hull-plate", facing: 0, level: 1, color: RED, accentColor: null,
            ...overrides,
        }
    }

    it("covers a hull block only where its shape is solid", () => {
        const half = block({ shape: "half" })

        // One of these is the solid side and one is the gap; which is which is
        // the shape's business, but they must differ
        expect(blockCovers(half, 0.5, 0.2)).not.toBe(blockCovers(half, 0.5, 0.8))
    })

    it("ignores the shape a component was placed with", () => {
        // The bug this pins: a battery placed while the brush held a quarter was
        // selectable across a quarter of itself, because its `shape` is brush
        // leftovers that nothing draws. The art decides, so the two agree exactly
        const asQuarter = block({ type: "battery", shape: "quarter" })
        const asFull = block({ type: "battery", shape: "full" })

        for (const [u, v] of [[0.1, 0.1], [0.9, 0.9], [0.5, 0.5], [0.9, 0.1]] as const) {
            expect(blockCovers(asQuarter, u, v)).toBe(blockCovers(asFull, u, v))
        }
    })

    it("follows a component's art rather than its cell", () => {
        // A turret is not a square: the space its barrel does not fill belongs to
        // whatever is drawn underneath, which is what lets a click reach the hull
        const turret = block({ type: "autocannon" })
        const points = [[0.02, 0.02], [0.5, 0.5], [0.98, 0.98], [0.02, 0.98]] as const

        const covered = points.map(([u, v]) => blockCovers(turret, u, v))
        expect(covered).toContain(true)
    })

    it("stops at the edges of the cell", () => {
        expect(blockCovers(block({ type: "battery" }), 1.4, 0.5)).toBe(false)
    })
})
