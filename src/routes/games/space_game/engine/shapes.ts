
export type BlockShape = "empty" | "full" | "wedge" | "arc"

const ARC_SEGMENTS = 8

interface CellFrame {
    x: number       // cell origin in world space
    y: number
    size: number
    turns: number   // 0-3, already normalised
}

/**
 * Appends `shape` as interleaved [x, y, r, g, b] triangles into `out`.
 *
 * @param turns quarter-turns clockwise, 0-3. Normalise it — the spec covers
 *        values past a full revolution and negative ones.
 */
export function appendShape(
    out: number[],
    shape: BlockShape,
    turns: number,
    x: number, y: number, size: number,
    r: number, g: number, b: number
): void {
    if (shape === "empty") return

    const frame: CellFrame = {
        x, y, size,
        // Handles turns past a full revolution and negative ones.
        turns: ((turns % 4) + 4) % 4
    }

    switch (shape) {
        case "full":
            pushQuad(out, frame, 0, 0, size, size, r, g, b)
            return

        case "wedge":
            // Canonical: the north-west half, hypotenuse running NE to SW.
            pushTriangle(out, frame, 0, 0, size, 0, 0, size, r, g, b)
            return

        case "arc":
            // Canonical: a quarter disc pinned to the north-west corner, so
            // the cell is full except for a rounded bite out of the south-east.
            pushArc(out, frame, 0, 0, size, 0, r, g, b)
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

function pushArc(
    out: number[],
    frame: CellFrame,
    cornerX: number, cornerY: number, radius: number, startAngle: number,
    r: number, g: number, b: number
) {
    for (let i = 0; i < ARC_SEGMENTS; i++) {
        const a0 = startAngle + (Math.PI / 2) * (i / ARC_SEGMENTS)
        const a1 = startAngle + (Math.PI / 2) * ((i + 1) / ARC_SEGMENTS)

        pushTriangle(out, frame,
            cornerX, cornerY,
            cornerX + Math.cos(a0) * radius, cornerY + Math.sin(a0) * radius,
            cornerX + Math.cos(a1) * radius, cornerY + Math.sin(a1) * radius,
            r, g, b)
    }
}