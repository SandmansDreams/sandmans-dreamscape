import { describe, expect, it } from "vitest"
import {
    appendShape,
    ARC_BITE, DRAWN_SHAPES, EDGE_LINE_ON, HALF_FILLS, MIRRORABLE_SHAPES,
    QUARTER_IN, RAMP_ON, WEDGE_SOLID,
    type BlockShape
} from "./shapes"

/**
 * Specification for the block tessellator.
 *
 * These assert the properties that are invisible on screen: that a shape emits
 * anything at all, that it covers the right area, and that it never escapes its
 * own cell. That last one is load-bearing — grid meshes ignore draw order
 * entirely, which is only safe because cells cannot overlap their neighbours.
 */

const SIZE = 20
const X = 10
const Y = 30

const R = 0.25
const G = 0.5
const B = 0.75

const FLOATS_PER_VERTEX = 5
const TURNS = [0, 1, 2, 3]

const CELL_CENTRE = { x: X + SIZE / 2, y: Y + SIZE / 2 }

/**
 * Derived, not listed — a shape added to BLOCK_SHAPES inherits every generic
 * assertion below without touching this file.
 */
const SOLID_SHAPES = DRAWN_SHAPES as BlockShape[]

/** Straight-edged shapes, whose area is exact. */
const STRAIGHT_AREA: Partial<Record<BlockShape, number>> = {
    full: SIZE * SIZE,
    half: (SIZE * SIZE) / 2,
    quarter: (SIZE * SIZE) / 4,
    wedge: (SIZE * SIZE) / 2,
    halfWedge: (SIZE * SIZE) / 4,
    band: (SIZE * SIZE) / 2,
    centerLine: (SIZE * SIZE) / 8,
    edgeLine: (SIZE * SIZE) / 8,
    diamond: (SIZE * SIZE) / 2,
}

/**
 * Curved shapes, approximated by flat segments — the polygon always lands just
 * under the true area, never over.
 */
const CURVED_AREA: Partial<Record<BlockShape, number>> = {
    arc: (Math.PI * SIZE * SIZE) / 4,        // quarter disc, radius = size
    halfArc: (Math.PI * SIZE * SIZE) / 8,    // quarter ellipse, squashed to half height
    circle: (Math.PI * SIZE * SIZE) / 4,     // inscribed, radius = size / 2
}

/** Shapes whose mass sits off-centre, so a quarter-turn relocates them. */
const OFF_CENTRE: BlockShape[] = [
    "half", "quarter", "wedge", "halfWedge", "arc", "halfArc", "edgeLine"
]

/** Shapes centred in the cell — rotation cannot move them. */
const CENTRED: BlockShape[] = ["full", "band", "centerLine", "diamond", "circle"]

interface Vertex {
    x: number
    y: number
    r: number
    g: number
    b: number
}

function build(shape: BlockShape, turns: number, mirrored = false): Vertex[] {
    const out: number[] = []
    appendShape(out, shape, turns, mirrored, X, Y, SIZE, R, G, B)

    expect(out.length % FLOATS_PER_VERTEX).toBe(0)

    const vertices: Vertex[] = []
    for (let i = 0; i < out.length; i += FLOATS_PER_VERTEX) {
        vertices.push({ x: out[i], y: out[i + 1], r: out[i + 2], g: out[i + 3], b: out[i + 4] })
    }
    return vertices
}

function triangleArea(a: Vertex, b: Vertex, c: Vertex): number {
    return Math.abs(a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2
}

function area(vertices: Vertex[]): number {
    let total = 0
    for (let i = 0; i + 2 < vertices.length; i += 3) {
        total += triangleArea(vertices[i], vertices[i + 1], vertices[i + 2])
    }
    return total
}

/**
 * Area-weighted centroid.
 *
 * Used instead of comparing vertex lists, which measures triangulation order
 * rather than where the shape actually sits — a rotated square emits different
 * vertices while looking identical.
 */
function centroid(vertices: Vertex[]): { x: number, y: number } {
    let total = 0
    let cx = 0
    let cy = 0

    for (let i = 0; i + 2 < vertices.length; i += 3) {
        const a = vertices[i]
        const b = vertices[i + 1]
        const c = vertices[i + 2]

        const weight = triangleArea(a, b, c)
        total += weight
        cx += ((a.x + b.x + c.x) / 3) * weight
        cy += ((a.y + b.y + c.y) / 3) * weight
    }

    return { x: cx / total, y: cy / total }
}

describe("appendShape", () => {
    it("emits nothing for empty", () => {
        for (const turns of TURNS) {
            expect(build("empty", turns)).toHaveLength(0)
        }
    })

    // A missing switch case silently draws nothing, which looks identical to a
    // shape being off screen. This is the cheapest way to catch it.
    it.each(SOLID_SHAPES)("emits geometry for %s at every rotation", (shape) => {
        for (const turns of TURNS) {
            expect(build(shape, turns).length).toBeGreaterThan(0)
        }
    })

    it.each(SOLID_SHAPES)("emits whole triangles for %s", (shape) => {
        for (const turns of TURNS) {
            expect(build(shape, turns).length % 3).toBe(0)
        }
    })

    it.each(SOLID_SHAPES)("carries the given colour on every vertex of %s", (shape) => {
        for (const vertex of build(shape, 0)) {
            expect(vertex.r).toBeCloseTo(R)
            expect(vertex.g).toBeCloseTo(G)
            expect(vertex.b).toBeCloseTo(B)
        }
    })

    // Grid meshes can be reordered freely (by colour, for draw batching) only
    // because no cell overlaps another. This is that guarantee.
    it.each(SOLID_SHAPES)("keeps %s strictly inside its own cell", (shape) => {
        for (const turns of TURNS) {
            for (const vertex of build(shape, turns)) {
                expect(vertex.x).toBeGreaterThanOrEqual(X - 1e-9)
                expect(vertex.x).toBeLessThanOrEqual(X + SIZE + 1e-9)
                expect(vertex.y).toBeGreaterThanOrEqual(Y - 1e-9)
                expect(vertex.y).toBeLessThanOrEqual(Y + SIZE + 1e-9)
            }
        }
    })

    describe("area", () => {
        // Forces a new shape to declare what it covers, rather than silently
        // going untested.
        it("has an expectation for every drawn shape", () => {
            for (const shape of SOLID_SHAPES) {
                const known = shape in STRAIGHT_AREA || shape in CURVED_AREA
                expect(known, `no area expectation for "${shape}"`).toBe(true)
            }
        })

        it.each(Object.keys(STRAIGHT_AREA) as BlockShape[])("%s covers its exact area", (shape) => {
            expect(area(build(shape, 0))).toBeCloseTo(STRAIGHT_AREA[shape]!, 6)
        })

        it.each(Object.keys(CURVED_AREA) as BlockShape[])("%s approximates its curve", (shape) => {
            const expected = CURVED_AREA[shape]!
            const actual = area(build(shape, 0))

            // An inscribed polygon can only undershoot.
            expect(actual).toBeLessThanOrEqual(expected)
            expect(actual).toBeGreaterThan(expected * 0.97)
        })
    })

    describe("rotation", () => {
        it("classifies every drawn shape as centred or off-centre", () => {
            for (const shape of SOLID_SHAPES) {
                const classified = OFF_CENTRE.includes(shape) || CENTRED.includes(shape)
                expect(classified, `"${shape}" is in neither OFF_CENTRE nor CENTRED`).toBe(true)
            }
        })

        // Rotating a shape moves its vertices but cannot change how much of the
        // cell it covers — a cheap check that the turn maths is a rotation and
        // not an accidental scale or shear.
        it.each(SOLID_SHAPES)("preserves the area of %s across all turns", (shape) => {
            const base = area(build(shape, 0))
            for (const turns of [1, 2, 3]) {
                expect(area(build(shape, turns))).toBeCloseTo(base, 6)
            }
        })

        it.each(OFF_CENTRE)("moves %s to a distinct place at each turn", (shape) => {
            const seen = new Set(
                TURNS.map(turns => {
                    const c = centroid(build(shape, turns))
                    return `${c.x.toFixed(6)},${c.y.toFixed(6)}`
                })
            )
            expect(seen.size).toBe(4)
        })

        it.each(CENTRED)("leaves %s centred at every turn", (shape) => {
            for (const turns of TURNS) {
                const c = centroid(build(shape, turns))
                expect(c.x).toBeCloseTo(CELL_CENTRE.x, 6)
                expect(c.y).toBeCloseTo(CELL_CENTRE.y, 6)
            }
        })

        it("wraps turns beyond a full revolution", () => {
            for (const shape of SOLID_SHAPES) {
                expect(build(shape, 4)).toEqual(build(shape, 0))
                expect(build(shape, 5)).toEqual(build(shape, 1))
            }
        })

        it("handles negative turns", () => {
            for (const shape of SOLID_SHAPES) {
                expect(build(shape, -1)).toEqual(build(shape, 3))
            }
        })
    })

    /**
     * The named turn constants are the interface hull code actually uses, so
     * they need pinning to the geometry rather than to a comment. Each is
     * checked by where the shape's mass lands relative to the cell centre.
     */
    describe("direction constants", () => {
        function expectMassToward(shape: BlockShape, turns: number, compass: string) {
            const c = centroid(build(shape, turns))

            if (compass.includes("N")) expect(c.y, `${compass}: expected mass north`).toBeLessThan(CELL_CENTRE.y)
            if (compass.includes("S")) expect(c.y, `${compass}: expected mass south`).toBeGreaterThan(CELL_CENTRE.y)
            if (compass.includes("W")) expect(c.x, `${compass}: expected mass west`).toBeLessThan(CELL_CENTRE.x)
            if (compass.includes("E")) expect(c.x, `${compass}: expected mass east`).toBeGreaterThan(CELL_CENTRE.x)
        }

        it.each(Object.entries(WEDGE_SOLID))("WEDGE_SOLID.%s keeps that corner", (corner, turns) => {
            expectMassToward("wedge", turns, corner)
        })

        it.each(Object.entries(HALF_FILLS))("HALF_FILLS.%s fills that side", (side, turns) => {
            expectMassToward("half", turns, side)
        })

        it.each(Object.entries(QUARTER_IN))("QUARTER_IN.%s sits in that corner", (corner, turns) => {
            expectMassToward("quarter", turns, corner)
        })

        it.each(Object.entries(RAMP_ON))("RAMP_ON.%s sits on that edge", (side, turns) => {
            expectMassToward("halfWedge", turns, side)
        })

        it.each(Object.entries(EDGE_LINE_ON))("EDGE_LINE_ON.%s runs along that edge", (side, turns) => {
            expectMassToward("edgeLine", turns, side)
        })

        // The arc is the inverse case: the bite is the *absent* corner, so the
        // remaining mass sits opposite it.
        it.each(Object.entries(ARC_BITE))("ARC_BITE.%s removes that corner", (corner, turns) => {
            const opposite = corner
                .replace("N", "s").replace("S", "n")
                .replace("E", "w").replace("W", "e")
                .toUpperCase()

            expectMassToward("arc", turns, opposite)
        })
    })

    describe("mirroring", () => {
        /** Centroids of all four turns, as a comparable set. */
        function centroidSet(shape: BlockShape, mirrored: boolean): Set<string> {
            return new Set(TURNS.map(turns => {
                const c = centroid(build(shape, turns, mirrored))
                return `${c.x.toFixed(6)},${c.y.toFixed(6)}`
            }))
        }

        // Reflection is area-preserving, so this catches a mirror implemented
        // as a translation or a squash.
        it.each(SOLID_SHAPES)("preserves the area of %s", (shape) => {
            for (const turns of TURNS) {
                expect(area(build(shape, turns, true)))
                    .toBeCloseTo(area(build(shape, turns, false)), 6)
            }
        })

        it.each(SOLID_SHAPES)("keeps mirrored %s inside its cell", (shape) => {
            for (const turns of TURNS) {
                for (const vertex of build(shape, turns, true)) {
                    expect(vertex.x).toBeGreaterThanOrEqual(X - 1e-9)
                    expect(vertex.x).toBeLessThanOrEqual(X + SIZE + 1e-9)
                    expect(vertex.y).toBeGreaterThanOrEqual(Y - 1e-9)
                    expect(vertex.y).toBeLessThanOrEqual(Y + SIZE + 1e-9)
                }
            }
        })

        // The two assertions below are what justify MIRRORABLE_SHAPES existing:
        // for everything else the mirror is genuinely redundant, and the chart
        // would waste a row on it.
        it.each(MIRRORABLE_SHAPES as BlockShape[])(
            "%s reaches four orientations rotation cannot",
            (shape) => {
                const plain = centroidSet(shape, false)
                const mirrored = centroidSet(shape, true)

                expect(plain.size).toBe(4)
                expect(mirrored.size).toBe(4)

                // Eight distinct placements in total.
                for (const position of mirrored) {
                    expect(plain.has(position), `${position} is also a rotation`).toBe(false)
                }
            }
        )

        it.each(SOLID_SHAPES.filter(s => !MIRRORABLE_SHAPES.includes(s)))(
            "mirroring %s only reproduces its rotations",
            (shape) => {
                const plain = centroidSet(shape, false)
                const mirrored = centroidSet(shape, true)

                expect([...mirrored].sort()).toEqual([...plain].sort())
            }
        )
    })
})
