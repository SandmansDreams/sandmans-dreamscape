// Drawing blocks with placeholder art for the functional kinds

import { Color } from "../color"
import { DEFAULT_FONT } from "../font"
import type { Vec2 } from "../camera"
import type { ComponentKind } from "./components"
import type { Cell, Grid } from "./grid"
import { appendShape, type BlockShape } from "./shapes"
import { appendTriangleOutline } from "./gridOutline"
import { MeshBuilder } from "../mesh"

/** Placeholder marks until functional blocks have real art. */
export const KIND_LETTER: Record<ComponentKind, string> = {
    hull: "",
    thruster: "T",
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

/**
 * The parts of a block these functions actually read.
 *
 * Narrower than Cell so the editor can preview a block it has not placed yet -
 * a ghost has no hit points or coordinates, and inventing them just to satisfy
 * a type would be a lie about what is being drawn.
 */
export interface BlockLike {
    shape: BlockShape
    turns: number
    mirrored: boolean
    kind: ComponentKind
    facing: number
    level: number
}

/** True when this kind draws as a placeholder rather than as its own shape. */
export function isComponent(block: BlockLike): boolean {
    return KIND_LETTER[block.kind] !== ""
}

/**
 * What a cell actually draws as: its own shape, or the machine placeholder.
 *
 * The solid mesh and the outline both ask this, so a functional block cannot be
 * a hexagon in one view and its underlying shape in the other.
 */
export function displayBlock(block: BlockLike): BlockDisplay {
    return isComponent(block)
        ? { shape: "hexagon", turns: 0, mirrored: false }
        : { shape: block.shape, turns: block.turns, mirrored: block.mirrored }
}

/** World position of a cell's north-west corner. */
function cellCorner(cell: Cell, cellSize: number, origin: Vec2): Vec2 {
    return {
        x: cell.col * cellSize - origin.x * cellSize,
        y: cell.row * cellSize - origin.y * cellSize,
    }
}

/**
 * The facing bar, initial and level that mark a component, without its body.
 *
 * Exported so the editor's ghost can preview exactly what a click will draw -
 * the alternative is the ghost showing the hull shape the brush last held,
 * which is not what gets placed.
 */
export function appendComponentGlyph(
    builder: MeshBuilder,
    block: BlockLike,
    x: number,
    y: number,
    cellSize: number,
    color: Color = LETTER_COLOR,
): void {
    // edgeLine is a thin bar flush against the north edge with four orientations,
    // so rotating it by `facing` is exactly a direction marker
    appendShape(builder, "edgeLine", block.facing, false, x, y, cellSize, color)

    const letter = KIND_LETTER[block.kind]
    const pixel = cellSize / 12

    DEFAULT_FONT.appendText(
        builder,
        letter,
        x + (cellSize - DEFAULT_FONT.measureText(letter, pixel)) / 2,
        y + (cellSize - DEFAULT_FONT.glyphHeight * pixel) / 2,
        pixel,
        color,
    )

    appendLevelDigit(builder, block, x, y, cellSize, color)
}

/**
 * The level, in the corner opposite the facing bar's usual home.
 *
 * Level 1 is left blank: it is the default every component starts at, and a "1"
 * on every block on the ship is noise that makes the upgraded ones harder to
 * pick out rather than easier.
 */
function appendLevelDigit(
    builder: MeshBuilder,
    block: BlockLike,
    x: number,
    y: number,
    cellSize: number,
    color: Color,
): void {
    if (block.level <= 1) return

    const text = String(block.level)
    const pixel = cellSize / 20

    DEFAULT_FONT.appendText(
        builder,
        text,
        x + cellSize - DEFAULT_FONT.measureText(text, pixel) - cellSize * 0.12,
        y + cellSize - DEFAULT_FONT.glyphHeight * pixel - cellSize * 0.1,
        pixel,
        color,
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
