// SVG previews of placed blocks, generated from the geometry that places them

import { Color } from "./color"
import { appendBlock, type BlockLike } from "./grid/blockDraw"
import { FLOATS_PER_VERTEX, MeshBuilder } from "./mesh"

/** One triangle of a preview, ready to drop into an <svg> as a <polygon>. */
export interface SvgTriangle {
    /** The "x,y x,y x,y" that a polygon's `points` wants. */
    points: string
    fill: string
}

/**
 * A block's art as coloured triangles, in a `size` by `size` box.
 *
 * The same rule the shape picker follows: run the code that draws the block
 * rather than hand-draw a thumbnail, so a swatch cannot disagree with what a
 * click places. A component with no art of its own previews as the hexagon and
 * letter placeholder for free, because that is what appendBlock gives it.
 *
 * One polygon per triangle rather than one path, because art carries its own
 * colours and a single fill would flatten a turret into a silhouette.
 */
export function blockSvgTriangles(block: BlockLike, size = 100): SvgTriangle[] {
    const builder = new MeshBuilder()
    appendBlock(builder, block, 0, 0, size)

    const data = builder.toArray()
    const out: SvgTriangle[] = []

    // Two decimals: arcs come out of cos/sin, and full precision would triple the
    // markup for sub-pixel detail nobody can see at swatch size
    const round = (value: number) => Number(value.toFixed(2))
    const stride = FLOATS_PER_VERTEX * 3

    for (let i = 0; i + stride <= data.length; i += stride) {
        out.push({
            points: [
                `${round(data[i]!)},${round(data[i + 1]!)}`,
                `${round(data[i + 5]!)},${round(data[i + 6]!)}`,
                `${round(data[i + 10]!)},${round(data[i + 11]!)}`,
            ].join(" "),

            // The first vertex speaks for the triangle: every run appendArt and
            // appendShape emit is a single colour, so the other two match it
            fill: Color.rgb(data[i + 2]!, data[i + 3]!, data[i + 4]!).hex,
        })
    }

    return out
}
