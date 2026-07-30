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
    | "triSE" | "triSW" | "triNE" | "triNW"
    | "arcNW" | "arcNE" | "arcSE" | "arcSW"

export type TriangleShape = "triNW" | "triNE" | "triSW" | "triSE"
export type ArcShape = "arcNW" | "arcNE" | "arcSE" | "arcSW"
export type HalfShape = "halfN" | "halfS" | "halfE" | "halfW"

export const BLOCK_MENU = [
    { shape: "full", label: "Full" },
    { shape: "triNW", label: "Wedge NW" },
    { shape: "triNE", label: "Wedge NE" },
    { shape: "triSE", label: "Wedge SE" },
    { shape: "triSW", label: "Wedge SW" },
    { shape: "arcNW", label: "Arc NW" },
    { shape: "arcNE", label: "Arc NE" },
    { shape: "arcSE", label: "Arc SE" },
    { shape: "arcSW", label: "Arc SW" },
] as const

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
