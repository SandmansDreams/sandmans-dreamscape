import { DRAWN_SHAPES, shapeColor } from "../../render/grid/palette"
import { MIRRORABLE_SHAPES, RAMP_ON, type BlockShape } from "../../render/grid/shapes"
import { Ship } from "../../game/ship"

/**
 * Every drawn shape, plus a mirrored copy of the three where mirroring is not
 * just another rotation.
 */
const VARIANTS: readonly { shape: BlockShape; mirrored: boolean }[] = DRAWN_SHAPES.flatMap((shape) =>
    MIRRORABLE_SHAPES.includes(shape)
        ? [{ shape, mirrored: false }, { shape, mirrored: true }]
        : [{ shape, mirrored: false }],
)

const MIN_COL = -3
const MAX_COL = 3
const MIN_ROW = -2
const MAX_ROW = 2

/**
 * The hull's outline, clockwise from the north-west corner, tagged with the edge
 * each cell sits on.
 *
 * The edge index doubles as the turn: every shape's canonical orientation faces
 * north, so turning it by its edge index points it out of the ship. That is what
 * makes the outline read as a border rather than a scatter of rotations.
 */
function* outline(): Generator<{ col: number; row: number; edge: number }> {
    for (let col = MIN_COL; col <= MAX_COL; col++) yield { col, row: MIN_ROW, edge: 0 }
    for (let row = MIN_ROW + 1; row <= MAX_ROW; row++) yield { col: MAX_COL, row, edge: 1 }
    for (let col = MAX_COL - 1; col >= MIN_COL; col--) yield { col, row: MAX_ROW, edge: 2 }
    for (let row = MAX_ROW - 1; row > MIN_ROW; row--) yield { col: MIN_COL, row, edge: 3 }
}

/**
 * Not a real ship - a reference sheet in ship form.
 *
 * Colors come from the same palette the shape chart uses, so a block here and
 * the same block there are directly comparable.
 */
export default function build(): Ship {
    const ship = new Ship("shape-test", "Shape Test")
    const { hull, coverable, placement } = ship.layers

    // Interior, so the outline has something to sit against
    hull.fill(MIN_COL + 1, MIN_ROW + 1, MAX_COL - 1, MAX_ROW - 1, "full", {
        color: shapeColor("full"),
    })

    const cells = [...outline()]
    VARIANTS.forEach((variant, index) => {
        // More variants than outline cells would mean growing the rectangle;
        // skipping is quieter than drawing them on top of each other
        const cell = cells[index]
        if (!cell) return

        hull.set(cell.col, cell.row, variant.shape, {
            turns: cell.edge,
            mirrored: variant.mirrored,
            color: shapeColor(variant.shape),
        })
    })

    // One of every functional kind, to check the placeholder letters and the
    // facing marker in all four directions at once
    coverable.set(-2, 0, "full", { kind: "thruster", facing: RAMP_ON.W })
    coverable.set(-1, 0, "full", { kind: "battery", facing: RAMP_ON.N })
    coverable.set(1, 0, "full", { kind: "storage", facing: RAMP_ON.S })
    coverable.set(2, 0, "full", { kind: "generator", facing: RAMP_ON.E })
    placement.set(0, -1, "full", { kind: "weapon", facing: RAMP_ON.N })
    placement.set(0, 1, "full", { kind: "projector", facing: RAMP_ON.S })

    return ship
}
