import type { Mat3Like, Vec3Like } from "ts-gl-matrix"
import { Vector2 } from "../physics/core"

// All block shapes possible
export const BLOCK_SHAPES = [
    "empty",
    // Rectangular fills
    "full",
    "half",
    "quarter",
    // Straight slopes
    "wedge",
    "halfWedge",
    // Curved
    "arc",
    "halfArc",
    // N-gon ish
    "hexagon",
    "octagon",
    "jutWedge",
    "jutHalfWedge",
    // Bars
    "band",
    "centerLine",
    "edgeLine",
    // Rotationally symmetric
    "diamond",
    "circle",
] as const

export type BlockShape = typeof BLOCK_SHAPES[number]
export const MIRRORABLE_SHAPES: readonly BlockShape[] = ["halfWedge", "halfArc", "jutHalfWedge"]

/** Which corner the arc's rounded bite is taken out of. */
export const ARC_BITE = { SE: 0, SW: 1, NW: 2, NE: 3 } as const
/** Which corner of the wedge keeps its right angle. */
export const WEDGE_SOLID = { NW: 0, NE: 1, SE: 2, SW: 3 } as const
/** Which corner `quarter` sits in. */
export const QUARTER_IN = { NW: 0, NE: 1, SE: 2, SW: 3 } as const
/** Which half of the cell `half` fills. */
export const HALF_FILLS = { N: 0, E: 1, S: 2, W: 3 } as const
/** Which edge `halfWedge` and `halfArc` sit flush against. */
export const RAMP_ON = { N: 0, E: 1, S: 2, W: 3 } as const
/** Which edge `edgeLine` runs along. */
export const EDGE_LINE_ON = { N: 0, E: 1, S: 2, W: 3 } as const

const JUT_SEGMENTS = 2
const OCT_SEGMENTS = 8
const HEX_SEGMENTS = 6
const ARC_SEGMENTS = 20
const CIRCLE_SEGMENTS = 40

interface CellFrame {
    position: Vector2
    size: number
    turns: number     // 0-3, already normalised
    mirrored: boolean // reflected across the cell's vertical centre line
}

/**
 * Appends `shape` as interleaved [x, y, r, g, b] triangles into `out`.
 *
 * Each shape is defined once in a canonical orientation using cell-local
 * coordinates from 0 to `size`; pushVertex applies the rotation.
 *
 * @param turns quarter-turns clockwise. Any integer — normalised here.
 * @param mirrored reflect across the cell's vertical centre line before
 *        rotating. Only meaningful for MIRRORABLE_SHAPES; for everything else
 *        the result coincides with one of the rotations.
 */
export function appendShape(
    out: number[],
    shape: BlockShape,
    turns: number,
    mirrored: boolean,
    x: number, y: number, size: number,
    r: number, g: number, b: number
): void {
    if (shape === "empty") return

    const frame: CellFrame = {
        position: new Vector2(x, y), 
        size,
        // Handles turns past a full revolution and negative ones.
        turns: ((turns % 4) + 4) % 4,
        mirrored
    }

    const half = size / 2
    const quarter = size / 4

    switch (shape) {
        case "full":
            pushQuad(out, frame, 0, 0, size, size, r, g, b)
            return

        case "half":
            // The north half, flush against the top edge.
            pushQuad(out, frame, 0, 0, size, half, r, g, b)
            return

        case "quarter":
            // The north-west quarter.
            pushQuad(out, frame, 0, 0, half, half, r, g, b)
            return

        case "wedge":
            // The north-west half, hypotenuse running NE to SW.
            pushTriangle(out, frame, 0, 0, size, 0, 0, size, r, g, b)
            return

        case "halfWedge":
            // A shallow ramp: full width along the north edge, tapering from
            // half height at the west to nothing at the east.
            pushTriangle(out, frame, 0, 0, size, 0, 0, half, r, g, b)
            return

        case "arc":
            // A quarter disc pinned to the north-west corner, so the cell is
            // full except for a rounded bite out of the south-east.
            pushFan(out, frame, 0, 0, size, size, 0, Math.PI / 2, ARC_SEGMENTS, r, g, b)
            return

        case "hexagon":
            // A centered hexagon, 2 rotations
            pushFan(out, frame, half, half, half, half, 0, Math.PI * 2, HEX_SEGMENTS, r, g, b)
            return

        case "octagon":
            // A centered octagon, no rotations
            pushFan(out, frame, half, half, half, half, 0, Math.PI * 2, OCT_SEGMENTS, r, g, b)
            return

        case "jutWedge":
            // A wedge with one additional segment jutting out
            pushFan(out, frame, 0, 0, size, size, 0, Math.PI / 2, JUT_SEGMENTS, r, g, b)
            return

        case "jutHalfWedge":
            // A half height jutWedge, mirrorable
            pushFan(out, frame, 0, 0, size, half, 0, Math.PI / 2, JUT_SEGMENTS, r, g, b)
            return

        case "halfArc":
            // The same sweep squashed vertically — a quarter ellipse.
            pushFan(out, frame, 0, 0, size, half, 0, Math.PI / 2, ARC_SEGMENTS, r, g, b)
            return

        case "band":
            // Half height, centred rather than pinned to an edge. Symmetric
            // under a half turn, so it has only two distinct orientations.
            pushQuad(out, frame, 0, quarter, size, size - quarter, r, g, b)
            return

        case "centerLine":
            // An eighth of the cell thick, centred. Two distinct orientations.
            pushQuad(out, frame, 0, half - size / 16, size, half + size / 16, r, g, b)
            return

        case "edgeLine":
            // The same thickness flush against the north edge. Being off-centre
            // gives it all four orientations, unlike the centred line.
            pushQuad(out, frame, 0, 0, size, size / 8, r, g, b)
            return

        case "diamond":
            // Corners at the four edge midpoints. Identical at every turn.
            pushTriangle(out, frame, half, 0, size, half, half, size, r, g, b)
            pushTriangle(out, frame, half, 0, half, size, 0, half, r, g, b)
            return

        case "circle":
            // Inscribed, touching all four edges. Identical at every turn.
            pushFan(out, frame, half, half, half, half, 0, Math.PI * 2, CIRCLE_SEGMENTS, r, g, b)
            return
    }
}

export function quad(x: number, y: number, size: number): number[] {
    const h = size / 2
    return [
        x - h, y - h,   x + h, y - h,   x + h, y + h,
        x - h, y - h,   x + h, y + h,   x - h, y + h,
    ]
}

/** One triangle, apex up, centered on (x, y). */
export function triangle(x: number, y: number, size: number): number[] {
    const h = size / 2
    return [
        x,     y + h,   // apex
        x - h, y - h,   // bottom left
        x + h, y - h,   // bottom right
    ]
}

function pushVertex(
    out: number[],
    frame: CellFrame,
    lx: number, ly: number,
    r: number, g: number, b: number
) {
    const half = frame.size / 2

    let dx = lx - half
    let dy = ly - half

    // Reflect first, then orient — mirroring in the shape's own frame rather
    // than the world's, so the two compose predictably.
    if (frame.mirrored) dx = -dx

    // Clockwise quarter turns in y-down. Exact — no trig involved.
    for (let i = 0; i < frame.turns; i++) {
        const swap = dx
        dx = -dy
        dy = swap
    }

    out.push(frame.position.x + half + dx, frame.position.y + half + dy, r, g, b)
}

function pushTriangle(
    out: number[],
    frame: CellFrame,
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number,
    r: number, g: number, b: number
) {
    pushVertex(out, frame, ax, ay, r, g, b)
    pushVertex(out, frame, bx, by, r, g, b)
    pushVertex(out, frame, cx, cy, r, g, b)
}

function pushQuad(
    out: number[],
    frame: CellFrame,
    left: number, top: number, right: number, bottom: number,
    r: number, g: number, b: number
) {
    pushTriangle(out, frame, left, top, right, top, right, bottom, r, g, b)
    pushTriangle(out, frame, left, top, right, bottom, left, bottom, r, g, b)
}

/**
 * A triangle fan sweeping an elliptical arc.
 *
 * Separate x and y radii let one helper cover the quarter disc, the squashed
 * half-height arc and the full circle.
 */
function pushFan(
    out: number[],
    frame: CellFrame,
    centreX: number, centreY: number,
    radiusX: number, radiusY: number,
    startAngle: number, sweep: number,
    segments: number,
    r: number, g: number, b: number
) {
    for (let i = 0; i < segments; i++) {
        const a0 = startAngle + sweep * (i / segments)
        const a1 = startAngle + sweep * ((i + 1) / segments)

        pushTriangle(out, frame,
            centreX, centreY,
            centreX + Math.cos(a0) * radiusX, centreY + Math.sin(a0) * radiusY,
            centreX + Math.cos(a1) * radiusX, centreY + Math.sin(a1) * radiusY,
            r, g, b)
    }
}