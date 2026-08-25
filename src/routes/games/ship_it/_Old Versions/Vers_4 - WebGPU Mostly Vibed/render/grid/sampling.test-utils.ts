// Shared by the geometry tests: comparing what a mesh covers, not how it is cut

import { FLOATS_PER_VERTEX } from "../mesh"

/*
 * Sample offsets, deliberately different per axis and off any neat fraction.
 *
 * A point exactly on an edge is inside or outside by float rounding, and
 * mirroring reverses the winding, which flips that tie. Offsetting both axes by
 * the SAME amount does not help: the diamond's edges are x - y = +-20, and a
 * uniform offset cancels in x - y, leaving the samples right back on the line.
 */
const OFFSET_X = 0.3183
const OFFSET_Y = 0.5171

/** The vertex positions in a mesh, as [x, y] pairs. */
export function pointsOf(data: Float32Array): number[][] {
    const points: number[][] = []
    for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) points.push([data[i]!, data[i + 1]!])
    return points
}

function cross(x: number, y: number, from: number[], to: number[]): number {
    return (x - to[0]!) * (from[1]! - to[1]!) - (from[0]! - to[0]!) * (y - to[1]!)
}

export function inTriangle(x: number, y: number, a: number[], b: number[], c: number[]): boolean {
    const d1 = cross(x, y, a, b)
    const d2 = cross(x, y, b, c)
    const d3 = cross(x, y, c, a)

    // A consistent sign means inside. Winding may be either way after a mirror,
    // so both all-negative and all-positive count.
    const negative = d1 < 0 || d2 < 0 || d3 < 0
    const positive = d1 > 0 || d2 > 0 || d3 > 0
    return !(negative && positive)
}

/**
 * The area a mesh covers, as a sampled bitmap over a `size` by `size` box.
 *
 * Compares the figure rather than the triangles: mirroring re-splits a quad
 * along the opposite diagonal, and merging replaces many quads with one, so two
 * identical areas can be built from completely different triangle sets.
 *
 * `samples` needs to out-resolve the smallest feature being compared - at the
 * default 24 a 16-cell sprite gets barely one sample per cell, which would miss
 * a single dropped block.
 */
export function coverageOf(data: Float32Array, size = 40, samples = 24): string {
    const points = pointsOf(data)
    let bitmap = ""

    for (let row = 0; row < samples; row++) {
        for (let column = 0; column < samples; column++) {
            const x = ((column + OFFSET_X) / samples) * size
            const y = ((row + OFFSET_Y) / samples) * size

            let inside = false
            for (let i = 0; i < points.length && !inside; i += 3) {
                inside = inTriangle(x, y, points[i]!, points[i + 1]!, points[i + 2]!)
            }
            bitmap += inside ? "#" : "."
        }
    }

    return bitmap
}