// The geometry for every block shape, each defined once in a canonical orientation

import type { MeshBuilder } from "../mesh"
import type { Color } from "../color"

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

/*
 * Compass tables: which way a shape's feature points for a given `turns` value.
 *
 * The world is y-DOWN, so north is y = 0, the top edge of the cell. Corner shapes
 * cycle NW->NE->SE->SW and edge shapes N->E->S->W, both falling out of the exact
 * rotation in pushVertex. These exist so authoring reads as ARC_BITE.NW rather
 * than the magic number 2.
 */

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

/*
 * Segment counts are chosen so a quarter turn maps the polygon exactly onto
 * itself: 6, 8 and 40 all divide 90 degrees evenly. Change one and that shape
 * starts wobbling between its four orientations.
 */
const JUT_SEGMENTS = 2
const OCT_SEGMENTS = 8
const HEX_SEGMENTS = 6
const ARC_SEGMENTS = 20
const CIRCLE_SEGMENTS = 40

/**
 * Shapes whose orientation count is not the usual four.
 *
 * Most blocks have four distinct turns; only the rotationally symmetric ones
 * and the half-turn ones differ. Listing just the exceptions keeps each reason
 * next to its number instead of burying them in a column of 4s.
 */
const TURN_EXCEPTIONS: Partial<Record<BlockShape, number>> = {
    empty: 1,
    full: 1,       // square, identical under every quarter turn
    octagon: 1,    // 45 degree symmetry divides 90 exactly
    diamond: 1,    // corners at the edge midpoints
    circle: 1,
    hexagon: 2,    // 60 degree symmetry, so a quarter turn only repeats at 180
    band: 2,       // symmetric under a half turn
    centerLine: 2, // centered, so it has no top and bottom to tell apart
}

export const DEFAULT_TURNS = 4

interface CellFrame {
    x: number
    y: number
    size: number
    turns: number // 0-3, already normalized
    mirrored: boolean
}

// Reused across calls, so tessellating a hull allocates nothing per cell, appendShape never yields, so there is no reentrancy to worry about
const scratch: number[] = []

// Append shape to MeshBuilder for rendering
export function appendShape(
    builder: MeshBuilder,
    shape: BlockShape,
    turns: number,
    mirrored: boolean,
    x: number,
    y: number,
    size: number,
    color: Color,
): void {
    if (shape === "empty") return

    const frame: CellFrame = {
        x,
        y,
        size,
        // Handles turns past a full revolution, and negative ones
        turns: ((turns % 4) + 4) % 4,
        mirrored,
    }

    scratch.length = 0
    buildShape(scratch, frame, shape)

    if (scratch.length > 0) builder.add(scratch, color)
}

// Builds a shape on switch-case statement from shape name
function buildShape(out: number[], frame: CellFrame, shape: BlockShape): void {
    const size = frame.size
    const half = size / 2
    const quarter = size / 4

    switch (shape) {
        case "empty":
            return

        case "full":
            pushQuad(out, frame, 0, 0, size, size)
            return

        case "half":
            // The north half, flush against the top edge
            pushQuad(out, frame, 0, 0, size, half)
            return

        case "quarter":
            // The north-west quarter
            pushQuad(out, frame, 0, 0, half, half)
            return

        case "wedge":
            // The north-west half, hypotenuse running NE to SW
            pushTriangle(out, frame, 0, 0, size, 0, 0, size)
            return

        case "halfWedge":
            // A shallow ramp: full width along the north edge, tapering from half
            // height at the west to nothing at the east
            pushTriangle(out, frame, 0, 0, size, 0, 0, half)
            return

        case "arc":
            // A quarter disc pinned to the north-west corner, so the cell is full
            // except for a rounded bite out of the south-east
            pushFan(out, frame, 0, 0, size, size, 0, Math.PI / 2, ARC_SEGMENTS)
            return

        case "halfArc":
            // The same sweep squashed vertically - a quarter ellipse
            pushFan(out, frame, 0, 0, size, half, 0, Math.PI / 2, ARC_SEGMENTS)
            return

        case "hexagon":
            // Centered. Two distinct orientations.
            pushFan(out, frame, half, half, half, half, 0, Math.PI * 2, HEX_SEGMENTS)
            return

        case "octagon":
            // Centered. Identical at every turn.
            pushFan(out, frame, half, half, half, half, 0, Math.PI * 2, OCT_SEGMENTS)
            return

        case "jutWedge":
            // A wedge with one extra segment jutting past the hypotenuse
            pushFan(out, frame, 0, 0, size, size, 0, Math.PI / 2, JUT_SEGMENTS)
            return

        case "jutHalfWedge":
            // A half-height jutWedge, mirrorable
            pushFan(out, frame, 0, 0, size, half, 0, Math.PI / 2, JUT_SEGMENTS)
            return

        case "band":
            // Half height, centered rather than pinned to an edge. Symmetric under a
            // half turn, so it has only two distinct orientations.
            pushQuad(out, frame, 0, quarter, size, size - quarter)
            return

        case "centerLine":
            // An eighth of the cell thick, centered. Two distinct orientations.
            pushQuad(out, frame, 0, half - size / 16, size, half + size / 16)
            return

        case "edgeLine":
            // The same thickness flush against the north edge. Being off-center gives
            // it all four orientations, unlike the centered line.
            pushQuad(out, frame, 0, 0, size, size / 8)
            return

        case "diamond":
            // Corners at the four edge midpoints. Identical at every turn.
            pushTriangle(out, frame, half, 0, size, half, half, size)
            pushTriangle(out, frame, half, 0, half, size, 0, half)
            return

        case "circle":
            // Inscribed, touching all four edges. Identical at every turn.
            pushFan(out, frame, half, half, half, half, 0, Math.PI * 2, CIRCLE_SEGMENTS)
            return
    }
}

function pushVertex(out: number[], frame: CellFrame, lx: number, ly: number): void {
    const half = frame.size / 2

    let dx = lx - half
    let dy = ly - half

    // Reflect first, then orient - mirroring in the shape's own frame rather than
    // the world's, so the two compose predictably whatever `turns` is
    if (frame.mirrored) dx = -dx

    // Clockwise quarter turns in y-down. Exact, no trig: vertices sitting on a cell
    // boundary stay bit-identical across rotations, so neighboring blocks never crack.
    for (let i = 0; i < frame.turns; i++) {
        const swap = dx
        dx = -dy
        dy = swap
    }

    out.push(frame.x + half + dx, frame.y + half + dy)
}

function pushTriangle(
    out: number[],
    frame: CellFrame,
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number,
): void {
    pushVertex(out, frame, ax, ay)
    pushVertex(out, frame, bx, by)
    pushVertex(out, frame, cx, cy)
}

/** An axis-aligned rect in local space, given as edges rather than x/y/w/h. */
function pushQuad(
    out: number[],
    frame: CellFrame,
    left: number, top: number,
    right: number, bottom: number,
): void {
    pushTriangle(out, frame, left, top, right, top, right, bottom)
    pushTriangle(out, frame, left, top, right, bottom, left, bottom)
}

/**
 * A triangle fan sweeping an elliptical arc, expanded into independent triangles.
 *
 * Separate x and y radii let one helper cover the quarter disc, the squashed
 * half-height arc, the jut wedges and the full circle.
 */
function pushFan(
    out: number[],
    frame: CellFrame,
    centerX: number, centerY: number,
    radiusX: number, radiusY: number,
    startAngle: number, sweep: number,
    segments: number,
): void {
    for (let i = 0; i < segments; i++) {
        const a0 = startAngle + sweep * (i / segments)
        const a1 = startAngle + sweep * ((i + 1) / segments)

        pushTriangle(
            out, frame,
            centerX, centerY,
            centerX + Math.cos(a0) * radiusX, centerY + Math.sin(a0) * radiusY,
            centerX + Math.cos(a1) * radiusX, centerY + Math.sin(a1) * radiusY,
        )
    }
}

export function turnCount(shape: BlockShape): number {
    return TURN_EXCEPTIONS[shape] ?? DEFAULT_TURNS
}

/** Total distinct states, mirroring included. */
export function variantCount(shape: BlockShape): number {
    return turnCount(shape) * (MIRRORABLE_SHAPES.includes(shape) ? 2 : 1)
}

/** Folds any integer onto the turns this shape actually has. */
export function normalizeTurns(shape: BlockShape, turns: number): number {
    const count = turnCount(shape)
    return ((turns % count) + count) % count
}