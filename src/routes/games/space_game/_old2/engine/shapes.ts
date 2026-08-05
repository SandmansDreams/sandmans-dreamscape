/**
 * Every block shape, in one place.
 *
 * The type is derived from this array rather than declared separately, so
 * adding a shape here is enough for the spec and the shape chart to pick it up
 * — both iterate this at runtime, which a union type cannot provide.
 */
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
    // Bars
    "band",
    "centerLine",
    "edgeLine",
    // Rotationally symmetric
    "diamond",
    "circle",
] as const

export type BlockShape = typeof BLOCK_SHAPES[number]

/** Shapes that produce geometry — everything except the empty cell. */
export const DRAWN_SHAPES: readonly BlockShape[] =
    BLOCK_SHAPES.filter(shape => shape !== "empty")

/**
 * Shapes where mirroring reaches an orientation rotation cannot.
 *
 * A quarter turn can never produce a mirror image, but for most shapes the
 * mirror happens to coincide with one of the rotations — a wedge reflected is
 * just a wedge turned. Only shapes asymmetric about their own diagonal gain
 * genuinely new states, and those need eight orientations rather than four to
 * build a symmetric hull.
 */
export const MIRRORABLE_SHAPES: readonly BlockShape[] = ["halfWedge", "halfArc"]

/**
 * Named turn values, so hull code says what it means.
 *
 * Writing `turns: 3` while meaning "bite out of the north-west" is a real and
 * silent mistake — the hull still renders, just wrong. These are verified in
 * the spec by checking where each variant's mass actually lands, so they
 * cannot drift from the tessellator.
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

/** Segments per quarter-turn of arc. */
const ARC_SEGMENTS = 8

/** Segments around a full circle — more, since it sweeps four times as far. */
const CIRCLE_SEGMENTS = 24

interface CellFrame {
    x: number         // cell origin in world space
    y: number
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
        x, y, size,
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

    out.push(frame.x + half + dx, frame.y + half + dy, r, g, b)
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
