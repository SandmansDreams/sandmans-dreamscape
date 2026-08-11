// Debug colors, one per block shape, shared so the chart and test ships agree

import type { RGB } from "../mesh"
import { BLOCK_SHAPES, type BlockShape } from "./shapes"

/** Every shape that actually draws something. "empty" would only be a blank row. */
export const DRAWN_SHAPES: readonly BlockShape[] = BLOCK_SHAPES.filter((shape) => shape !== "empty")

export const SHAPE_COLORS: readonly RGB[] = [
    [0.35, 0.65, 1.00], // blue
    [1.00, 0.55, 0.25], // orange
    [0.45, 0.85, 0.45], // green
    [1.00, 0.45, 0.70], // pink
    [0.95, 0.85, 0.35], // yellow
    [0.35, 0.90, 0.90], // cyan
    [0.70, 0.50, 1.00], // purple
    [1.00, 0.40, 0.40], // red
    [0.30, 0.75, 0.65], // teal
    [0.75, 0.95, 0.35], // lime
    [0.85, 0.65, 0.45], // tan
    [0.60, 0.75, 1.00], // periwinkle
    [0.95, 0.60, 0.85], // magenta
    [0.55, 0.90, 0.70], // mint
]

/**
 * A shape's debug color, keyed by its position in DRAWN_SHAPES.
 *
 * Both the shape chart and the shape-test ship go through here, so a block in
 * the chart and the same block on the ship are always the same color - that is
 * what makes the two comparable side by side.
 */
export function shapeColor(shape: BlockShape): RGB {
    const index = DRAWN_SHAPES.indexOf(shape)
    return SHAPE_COLORS[(index < 0 ? 0 : index) % SHAPE_COLORS.length]!
}
