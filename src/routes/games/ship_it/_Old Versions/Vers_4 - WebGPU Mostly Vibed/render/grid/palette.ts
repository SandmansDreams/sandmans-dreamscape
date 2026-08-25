// Debug colors, one per block shape, shared so the chart and test ships agree

import { Color } from "../color"
import { BLOCK_SHAPES, type BlockShape } from "./shapes"

/** Every shape that actually draws something. "empty" would only be a blank row. */
export const DRAWN_SHAPES: readonly BlockShape[] = BLOCK_SHAPES.filter((shape) => shape !== "empty")

export const SHAPE_COLORS: readonly Color[] = [
    Color.rgb(0.35, 0.65, 1.00), // blue
    Color.rgb(1.00, 0.55, 0.25), // orange
    Color.rgb(0.45, 0.85, 0.45), // green
    Color.rgb(1.00, 0.45, 0.70), // pink
    Color.rgb(0.95, 0.85, 0.35), // yellow
    Color.rgb(0.35, 0.90, 0.90), // cyan
    Color.rgb(0.70, 0.50, 1.00), // purple
    Color.rgb(1.00, 0.40, 0.40), // red
    Color.rgb(0.30, 0.75, 0.65), // teal
    Color.rgb(0.75, 0.95, 0.35), // lime
    Color.rgb(0.85, 0.65, 0.45), // tan
    Color.rgb(0.60, 0.75, 1.00), // periwinkle
    Color.rgb(0.95, 0.60, 0.85), // magenta
    Color.rgb(0.55, 0.90, 0.70), // mint
]

/**
 * A shape's debug color, keyed by its position in DRAWN_SHAPES.
 *
 * Both the shape chart and the shape-test ship go through here, so a block in
 * the chart and the same block on the ship are always the same color - that is
 * what makes the two comparable side by side.
 */
export function shapeColor(shape: BlockShape): Color {
    const index = DRAWN_SHAPES.indexOf(shape)
    return SHAPE_COLORS[(index < 0 ? 0 : index) % SHAPE_COLORS.length]!
}
