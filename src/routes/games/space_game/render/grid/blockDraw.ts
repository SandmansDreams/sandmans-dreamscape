// Drawing blocks with placeholder art for the functional categories

import { Color } from "../color"
import { DEFAULT_FONT } from "../font"
import type { Vec2 } from "../camera"
import { componentById, kindOf, type ComponentKind } from "./components"
import { cellKey, type Cell, type Grid } from "./grid"
import { appendShape, trianglesCover, type BlockShape } from "./shapes"
import { appendTriangleOutline } from "./gridOutline"
import { FLOATS_PER_VERTEX, MeshBuilder } from "../mesh"
import { findArt } from "../../assets/components"
import { appendGlow } from "../glow"
import type { ComponentArt } from "../../game/componentArt"
import { ART_LAYERS, ART_ROLES, type ArtLayer, type ArtRole } from "./spriteMesh"
import type { SpillMap } from "../../game/emissiveSpill"

/**
 * Placeholder marks until functional blocks have real art.
 *
 * Keyed by category rather than by type: the letter says "this is a machine and
 * roughly what sort", which is all a placeholder can honestly claim. Two models
 * of thruster share a T until one of them has art of its own.
 */
export const KIND_LETTER: Record<ComponentKind, string> = {
    hull: "",
    thruster: "T",
    cargo: "C",
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
    /** A registry id. `kindOf` is how the placeholder finds its letter. */
    type: string
    facing: number
    level: number
    /** The main tint. Art's `main` role takes this; a plain block is drawn in it. */
    color: Color
    /** The accent tint, or null to keep whatever the art was drawn with. */
    accentColor: Color | null
    /**
     * 0 for a surface the light shades, 1 for one that lights itself.
     *
     * Optional because a ghost or a swatch has no business having one, and the
     * lit shader reads absent as zero either way.
     */
    emission?: number
}

/** True when this block draws as a placeholder rather than as its own shape. */
export function isComponent(block: BlockLike): boolean {
    return KIND_LETTER[kindOf(block.type)] !== ""
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

    const letter = KIND_LETTER[kindOf(block.type)]
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

/** One quarter turn clockwise about the unit cell's center, in y-down space. */
function turn(u: number, v: number): [u: number, v: number] {
    return [1 - v, u]
}

/**
 * A piece of art's triangles, placed at one cell.
 *
 * The mesh is baked into the 0..1 box a cell occupies, so placing it is a scale
 * and an offset. Rotation by `facing` is baked here on the CPU, as appendShape
 * already does for quarter turns - one authored piece serves all four headings
 * and the GPU needs no new path.
 *
 * `main` and `accent` have their colour replaced outright, which is what lets one
 * turret design serve a whole fleet. `static` keeps what it was drawn with.
 */
function appendArt(
    builder: MeshBuilder,
    art: ComponentArt,
    block: BlockLike,
    x: number,
    y: number,
    cellSize: number,
    fade: number,
    fadeTo: Color,
    layers: readonly ArtLayer[],
): void {
    const tint: Record<ArtRole, Color | null> = {
        static: null,
        main: block.color,
        // The art's own accent is the fallback, so an unset cell looks the way the
        // piece was drawn rather than the way the grid guessed
        accent: block.accentColor ?? Color.from(art.accentColor),
    }

    // Layers outermost so base always draws under top, which is the whole reason
    // the art is split in two
    for (const layer of layers) {
        for (const role of ART_ROLES) {
            const source = art.mesh[layer][role]
            if (source.length === 0) continue

            const out: number[] = []

            for (let i = 0; i < source.length; i += FLOATS_PER_VERTEX) {
                let u = source[i]!
                let v = source[i + 1]!
                for (let step = 0; step < block.facing; step++) [u, v] = turn(u, v)

                const base = tint[role]
                    ?? Color.rgb(source[i + 2]!, source[i + 3]!, source[i + 4]!)
                const { r, g, b } = fade === 0 ? base : base.mix(fadeTo, fade)

                out.push(x + u * cellSize, y + v * cellSize, r, g, b)
            }

            builder.raw(out)
        }
    }
}

/**
 * The art this block wears, or null when it draws as geometry instead.
 *
 * A hull never wears art even when a file exists for it. Its shape is the whole
 * point - wedges, arcs and full blocks are what let a hull be a silhouette
 * rather than a rectangle - and one sprite would paint the same picture over
 * every one of them. Components are the reverse case: the hexagon was always a
 * placeholder standing in for art nobody had drawn yet, so art wins there.
 */
function artFor(block: BlockLike): ComponentArt | null {
    if (!isComponent(block)) return null

    return findArt(componentById(block.type), block.level)
}

/**
 * One block, as its own art or as the placeholder.
 *
 * The single place that decides how a block looks. The editor's ghost draws
 * through here too, so what a click promises and what it places cannot drift
 * apart - they did, and the ghost showed a hexagon over art.
 */
export function appendBlock(
    builder: MeshBuilder,
    block: BlockLike,
    x: number,
    y: number,
    cellSize: number,
    fade = 0,
    fadeTo: Color = Color.BLACK,
    /** What the emissive cells around this one throw onto it. */
    spill?: Color,
    /**
     * Which art layers to draw. Both, unless something else is drawing one.
     *
     * A turret's `top` is its barrel, and a barrel that turns cannot be baked into
     * the hull's mesh with everything else - it is drawn per mount instead, which
     * is exactly what the layer split was for.
     */
    layers: readonly ArtLayer[] = ART_LAYERS,
): void {
    // Named before anything is appended, so art, shape and glyph all inherit it.
    // This is the one place that knows which cell a triangle belongs to, and the
    // lit shader treats the direction out to this point as the cell's normal.
    builder.inCell(x + cellSize / 2, y + cellSize / 2, block.emission, spill)

    const art = artFor(block)
    if (art) {
        appendArt(builder, art, block, x, y, cellSize, fade, fadeTo, layers)
        return
    }

    const { shape, turns, mirrored } = displayBlock(block)
    const color = fade === 0 ? block.color : block.color.mix(fadeTo, fade)

    appendShape(builder, shape, turns, mirrored, x, y, cellSize, color)

    // The glyph fades with its block, or a dimmed thruster keeps a solid black
    // T floating on it
    if (isComponent(block)) {
        const ink = fade === 0 ? LETTER_COLOR : LETTER_COLOR.mix(fadeTo, fade)
        appendComponentGlyph(builder, block, x, y, cellSize, ink)
    }
}

/**
 * Every block on a layer, each drawn as its own art where it has any.
 *
 * A component with no art falls back to a hexagon carrying its initial and a bar
 * on the edge it faces, which reads as "this is a machine, not structure" at any
 * zoom and lets art be authored one piece at a time.
 */
export function appendLayer(
    builder: MeshBuilder,
    grid: Grid,
    cellSize: number,
    origin: Vec2,
    /**
     * How far every colour is washed toward `fadeTo`, 0 drawing the layer as it is.
     *
     * A mix rather than an alpha: the vertex format carries no alpha channel and
     * the shader writes 1.0, so fading against the known background is what
     * "translucent" means here - the same trick the editor's ghost uses.
     */
    fade = 0,
    fadeTo: Color = Color.BLACK,
    /** Per-cell glow from spillOnto(). Omitted for anything drawn unlit. */
    spill?: SpillMap,
    /**
     * Cells whose `top` art this mesh should leave out because it moves.
     *
     * A turret's barrel turns independently of the hull, so baking it in here
     * would weld it straight ahead. Omit the predicate and every block is drawn
     * whole, which is what the builder and the viewer want.
     */
    movesOwnTop?: (cell: Cell) => boolean,
): void {
    for (const cell of grid.list) {
        const { x, y } = cellCorner(cell, cellSize, origin)
        const layers = movesOwnTop?.(cell) ? BASE_ONLY : ART_LAYERS

        appendBlock(
            builder, cell, x, y, cellSize, fade, fadeTo,
            spill?.get(cellKey(cell.col, cell.row)), layers,
        )
    }
}

/** Everything but the moving part. */
const BASE_ONLY: readonly ArtLayer[] = ["base"]

/**
 * Just the moving part of a block, about the cell's own centre.
 *
 * Centred rather than cornered because it is going to be spun: an instance
 * rotates about its origin, and a barrel has to turn about its mount rather than
 * about the corner of the cell it sits in.
 *
 * Drawn at facing 0 - the orientation the art was authored in - so the instance's
 * rotation carries the whole aim rather than fighting a quarter turn baked in here.
 */
export function appendBlockTop(builder: MeshBuilder, block: BlockLike, cellSize: number): void {
    const art = artFor(block)
    if (!art) return

    appendArt(
        builder,
        art,
        { ...block, facing: 0 },
        -cellSize / 2,
        -cellSize / 2,
        cellSize,
        0,
        Color.BLACK,
        TOP_ONLY,
    )
}

const TOP_ONLY: readonly ArtLayer[] = ["top"]

/**
 * The triangles a block draws, in a unit cell, cached by what decides them.
 *
 * Hit-testing runs every frame the cursor moves, across every layer, and a
 * turret is a few hundred triangles - re-tessellating it per frame to answer
 * "is the cursor on it" would be most of a frame for an answer that never
 * changes. Colour is normalised out because it moves no vertex.
 */
const COVER_CACHE = new Map<string, Float32Array>()

function coverTriangles(block: BlockLike): Float32Array {
    const key = `${block.type}|${block.level}|${block.facing}|`
        + `${block.shape}|${block.turns}|${block.mirrored}`

    const cached = COVER_CACHE.get(key)
    if (cached) return cached

    const builder = new MeshBuilder()
    appendBlock(builder, { ...block, color: Color.WHITE, accentColor: null }, 0, 0, 1)

    const data = builder.toArray()
    COVER_CACHE.set(key, data)
    return data
}

/**
 * True when a point inside a cell lands on the block actually drawn there.
 *
 * Tested against the triangles `appendBlock` emits, which is the only honest
 * answer: a turret with a narrow barrel leaves real space around it, and pointing
 * at that space means pointing at the hull underneath. Testing the cell's `shape`
 * instead was worse than wrong for a component - that field is brush leftovers
 * nothing renders, so a battery answered for a quarter of itself.
 *
 * @param u across the cell, 0 at its left edge and 1 at its right
 * @param v down the cell, 0 at its top edge and 1 at its bottom
 */
export function blockCovers(block: BlockLike, u: number, v: number): boolean {
    return trianglesCover(coverTriangles(block), u, v)
}

/**
 * How far past its own cell an emissive block bleeds, as a multiple of the cell.
 *
 * Just over one, because a halo that stops at the cell's edge reads as a brighter
 * block rather than as a light. Past about 1.5 the neighbours wash out and the
 * ship stops looking like plates with windows in it.
 */
const BLOOM_SPREAD = 0.85

/**
 * How much of an emissive cell's colour its halo carries at full emission.
 *
 * Deliberately low: the cell is already drawn at full brightness by the shading,
 * and this is the spill around it rather than the light itself.
 */
const BLOOM_STRENGTH = 0.18

/**
 * A soft halo over every cell that lights itself.
 *
 * Its own mesh, drawn additively over the hull: bloom is light spilling past an
 * edge, so it has to be laid over the finished ship rather than shaded into it.
 * The lit shader already keeps an emissive cell at full brightness; this is only
 * what leaks out around it.
 *
 * No cell channel is recorded, so this mesh cannot be drawn by the lit pipeline -
 * which is correct, since shading a glow would be lighting a light.
 */
export function appendEmissiveBloom(
    builder: MeshBuilder,
    grid: Grid,
    cellSize: number,
    origin: Vec2,
    strength = BLOOM_STRENGTH,
): void {
    for (const cell of grid.list) {
        if (cell.emission <= 0) continue

        const { x, y } = cellCorner(cell, cellSize, origin)
        const amount = Math.min(cell.emission, 1) * strength

        appendGlow(
            builder,
            x + cellSize / 2,
            y + cellSize / 2,
            cellSize * BLOOM_SPREAD,
            Color.rgb(cell.color.r * amount, cell.color.g * amount, cell.color.b * amount),
        )
    }
}

/**
 * Every block on a layer, outlined from the triangles it actually draws.
 *
 * Not appendGridOutline with a shape substitution: that asks what shape a cell
 * stands in for, and art does not stand in for a shape. Deriving the lines from
 * the block's own geometry means the two views cannot disagree - a turret
 * outlines as a turret, and a component still waiting on art outlines as the
 * hexagon and letter it is drawn as, with no second code path for either.
 *
 * Per cell, so one block's edges never cancel against its neighbour's:
 * cancelling those would give the hull's silhouette instead of a diagram of its
 * blocks.
 */
export function appendLayerOutline(
    out: number[],
    grid: Grid,
    cellSize: number,
    origin: Vec2,
    /** One color for every line. Omit to keep each block's own. */
    color?: Color,
): void {
    // One builder reused across cells rather than one per block
    const scratch = new MeshBuilder()

    for (const cell of grid.list) {
        const { x, y } = cellCorner(cell, cellSize, origin)

        scratch.clear()
        appendBlock(scratch, cell, x, y, cellSize)
        appendTriangleOutline(out, scratch.toArray(), color ?? cell.color)
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
