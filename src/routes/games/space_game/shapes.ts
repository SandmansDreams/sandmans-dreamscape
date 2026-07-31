/**
 * The block shapes a grid cell can take, and the one place that knows how to
 * draw them.
 *
 * Hull cells, editor ghosts, asteroid tiles and the UI palette previews all
 * render the same geometry, so they all go through fillBlockShape rather than
 * each re-deriving the corner and arc maths.
 */

export type BlockShape =
    | "empty"
    | "full"
    | "halfN" | "halfS" | "halfE" | "halfW"
    | "quarterNW" | "quarterNE" | "quarterSE" | "quarterSW"
    | "triSE" | "triSW" | "triNE" | "triNW"
    | "arcNW" | "arcNE" | "arcSE" | "arcSW"
    | RampShape

export type TriangleShape = "triNW" | "triNE" | "triSW" | "triSE"
export type ArcShape = "arcNW" | "arcNE" | "arcSE" | "arcSW"
export type HalfShape = "halfN" | "halfS" | "halfE" | "halfW"
export type QuarterShape = "quarterNW" | "quarterNE" | "quarterSE" | "quarterSW"

/**
 * Half-height wedges — shallow ramps, half the rise of a `tri*` wedge.
 *
 * Named `ramp<Base><Tall>`: the first letter is the cell edge the ramp sits
 * flush against, the second is the end of that edge where it reaches full
 * thickness. `rampSE` rests on the south edge and rises to the south-east
 * corner.
 *
 * There are eight rather than four because a 90-degree rotation can't produce
 * a mirror image, and a symmetric hull needs both hands of every slope.
 */
export type RampShape =
    | "rampSE" | "rampSW"
    | "rampNE" | "rampNW"
    | "rampEN" | "rampES"
    | "rampWN" | "rampWS"

/**
 * Fills `shape` into the square at (x, y) with side `size`, using the
 * context's current fillStyle. All shapes stay strictly inside that square,
 * so cells never overlap and draw order is irrelevant.
 */
export function fillBlockShape(
    ctx: CanvasRenderingContext2D,
    shape: BlockShape,
    x: number,
    y: number,
    size: number
) {
    switch (shape) {
        case "empty":
            return

        case "full":
            ctx.fillRect(x, y, size, size)
            return

        case "halfN": ctx.fillRect(x, y, size, size / 2); return
        case "halfS": ctx.fillRect(x, y + size / 2, size, size / 2); return
        case "halfW": ctx.fillRect(x, y, size / 2, size); return
        case "halfE": ctx.fillRect(x + size / 2, y, size / 2, size); return

        case "quarterNW": ctx.fillRect(x, y, size / 2, size / 2); return
        case "quarterNE": ctx.fillRect(x + size / 2, y, size / 2, size / 2); return
        case "quarterSE": ctx.fillRect(x + size / 2, y + size / 2, size / 2, size / 2); return
        case "quarterSW": ctx.fillRect(x, y + size / 2, size / 2, size / 2); return

        case "triNW":
        case "triNE":
        case "triSW":
        case "triSE":
            fillTriangle(ctx, shape, x, y, size)
            return

        case "arcNW":
        case "arcNE":
        case "arcSE":
        case "arcSW":
            fillArc(ctx, shape, x, y, size)
            return

        case "rampSE":
        case "rampSW":
        case "rampNE":
        case "rampNW":
        case "rampEN":
        case "rampES":
        case "rampWN":
        case "rampWS":
            fillRamp(ctx, shape, x, y, size)
            return
    }
}

function fillTriangle(
    ctx: CanvasRenderingContext2D,
    shape: TriangleShape,
    x: number,
    y: number,
    size: number
) {
    const right = x + size
    const bottom = y + size

    ctx.beginPath()

    // Each wedge keeps its named corner and cuts the opposite one.
    switch (shape) {
        case "triNW":
            ctx.moveTo(x, y); ctx.lineTo(right, y); ctx.lineTo(x, bottom)
            break
        case "triNE":
            ctx.moveTo(right, y); ctx.lineTo(x, y); ctx.lineTo(right, bottom)
            break
        case "triSW":
            ctx.moveTo(x, bottom); ctx.lineTo(x, y); ctx.lineTo(right, bottom)
            break
        case "triSE":
            ctx.moveTo(right, bottom); ctx.lineTo(right, y); ctx.lineTo(x, bottom)
            break
    }

    ctx.closePath()
    ctx.fill()
}

/**
 * Half-height wedge: a right triangle whose long leg is a full cell edge and
 * whose short leg is half the perpendicular edge, giving a ~26-degree slope
 * instead of the 45 a `tri*` wedge gives.
 */
function fillRamp(
    ctx: CanvasRenderingContext2D,
    shape: RampShape,
    x: number,
    y: number,
    size: number
) {
    const right = x + size
    const bottom = y + size
    const midX = x + size / 2
    const midY = y + size / 2

    ctx.beginPath()

    switch (shape) {
        // Sitting on a horizontal edge: full width, rising to half height.
        case "rampSE":
            ctx.moveTo(x, bottom); ctx.lineTo(right, bottom); ctx.lineTo(right, midY)
            break
        case "rampSW":
            ctx.moveTo(right, bottom); ctx.lineTo(x, bottom); ctx.lineTo(x, midY)
            break
        case "rampNE":
            ctx.moveTo(x, y); ctx.lineTo(right, y); ctx.lineTo(right, midY)
            break
        case "rampNW":
            ctx.moveTo(right, y); ctx.lineTo(x, y); ctx.lineTo(x, midY)
            break

        // Sitting on a vertical edge: full height, rising to half width.
        case "rampEN":
            ctx.moveTo(right, bottom); ctx.lineTo(right, y); ctx.lineTo(midX, y)
            break
        case "rampES":
            ctx.moveTo(right, y); ctx.lineTo(right, bottom); ctx.lineTo(midX, bottom)
            break
        case "rampWN":
            ctx.moveTo(x, bottom); ctx.lineTo(x, y); ctx.lineTo(midX, y)
            break
        case "rampWS":
            ctx.moveTo(x, y); ctx.lineTo(x, bottom); ctx.lineTo(midX, bottom)
            break
    }

    ctx.closePath()
    ctx.fill()
}

function fillArc(
    ctx: CanvasRenderingContext2D,
    shape: ArcShape,
    x: number,
    y: number,
    size: number
) {
    // A quarter disc of radius `size` pinned to the named corner: it fills the
    // cell except for a rounded bite out of the opposite corner.
    let cx: number, cy: number, start: number, end: number

    switch (shape) {
        case "arcNW":
            cx = x; cy = y; start = 0; end = Math.PI / 2
            break
        case "arcNE":
            cx = x + size; cy = y; start = Math.PI / 2; end = Math.PI
            break
        case "arcSE":
            cx = x + size; cy = y + size; start = Math.PI; end = Math.PI * 1.5
            break
        case "arcSW":
            cx = x; cy = y + size; start = Math.PI * 1.5; end = Math.PI * 2
            break
    }

    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, size, start, end)
    ctx.closePath()
    ctx.fill()
}
