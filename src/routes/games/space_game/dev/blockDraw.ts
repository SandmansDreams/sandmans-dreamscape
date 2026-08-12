// Drawing blocks with placeholder art for the functional kinds

import { Color } from "../render/color"
import { DEFAULT_FONT } from "../render/font"
import type { Vec2 } from "../render/camera"
import type { ComponentKind } from "../render/grid/components"
import type { Cell, Grid } from "../render/grid/grid"
import { appendShape, type BlockShape } from "../render/grid/shapes"
import { appendTriangleOutline } from "../render/grid/gridOutline"
import { MeshBuilder } from "../render/mesh"

/** Placeholder marks until functional blocks have real art. */
export const KIND_LETTER: Record<ComponentKind, string> = {
    hull: "",
    thruster: "T",
    battery: "B",
    storage: "S",
    generator: "G",
    projector: "P",
    weapon: "W",
}

const LETTER_COLOR = Color.hex("#242424")

export interface BlockDisplay {
    shape: BlockShape
    turns: number
    mirrored: boolean
}

/** True when this kind draws as a placeholder rather than as its own shape. */
export function isComponent(cell: Cell): boolean {
    return KIND_LETTER[cell.kind] !== ""
}

/**
 * What a cell actually draws as: its own shape, or the machine placeholder.
 *
 * The solid mesh and the outline both ask this, so a functional block cannot be
 * a hexagon in one view and its underlying shape in the other.
 */
export function displayBlock(cell: Cell): BlockDisplay {
    return isComponent(cell)
        ? { shape: "hexagon", turns: 0, mirrored: false }
        : { shape: cell.shape, turns: cell.turns, mirrored: cell.mirrored }
}

/** World position of a cell's north-west corner. */
function cellCorner(cell: Cell, cellSize: number, origin: Vec2): Vec2 {
    return {
        x: cell.col * cellSize - origin.x * cellSize,
        y: cell.row * cellSize - origin.y * cellSize,
    }
}

/** The facing bar and initial that mark a component, without its body. */
function appendComponentGlyph(
    builder: MeshBuilder,
    cell: Cell,
    x: number,
    y: number,
    cellSize: number,
): void {
    // edgeLine is a thin bar flush against the north edge with four orientations,
    // so rotating it by `facing` is exactly a direction marker
    appendShape(builder, "edgeLine", cell.facing, false, x, y, cellSize, LETTER_COLOR)

    const letter = KIND_LETTER[cell.kind]
    const pixel = cellSize / 12

    DEFAULT_FONT.appendText(
        builder,
        letter,
        x + (cellSize - DEFAULT_FONT.measureText(letter, pixel)) / 2,
        y + (cellSize - DEFAULT_FONT.glyphHeight * pixel) / 2,
        pixel,
        LETTER_COLOR,
    )
}

/**
 * Like appendGridMesh, but components draw as a hexagon carrying their initial
 * and a bar on the edge they face.
 *
 * Temporary: functional blocks have no art yet, and a hexagon reads as "this is
 * a machine, not structure" at any zoom.
 */
export function appendLayer(
    builder: MeshBuilder,
    grid: Grid,
    cellSize: number,
    origin: Vec2,
): void {
    for (const cell of grid.list) {
        const { x, y } = cellCorner(cell, cellSize, origin)
        const { shape, turns, mirrored } = displayBlock(cell)

        appendShape(builder, shape, turns, mirrored, x, y, cellSize, cell.color)
        if (isComponent(cell)) appendComponentGlyph(builder, cell, x, y, cellSize)
    }
}

/**
 * Component glyphs as line segments, for the wireframe view.
 *
 * Glyph runs are triangles like everything else, so the same edge cancellation
 * that outlines a block outlines a letter - no second algorithm, and the letters
 * land in the same line mesh as the blocks rather than needing their own pass.
 *
 * Outlined per cell, so one component's marks never merge with its neighbour's.
 */
export function appendComponentGlyphOutlines(
    out: number[],
    grid: Grid,
    cellSize: number,
    origin: Vec2,
    color: Color,
): void {
    // One builder reused across cells rather than one per component
    const scratch = new MeshBuilder()

    for (const cell of grid.list) {
        if (!isComponent(cell)) continue

        const { x, y } = cellCorner(cell, cellSize, origin)

        scratch.clear()
        appendComponentGlyph(scratch, cell, x, y, cellSize)
        appendTriangleOutline(out, scratch.toArray(), color)
    }
}
