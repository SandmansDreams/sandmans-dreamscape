// Baking authored component art down to the fewest triangles that still draw it

import type { ArtCell } from "./artGrid"
import { appendShape } from "./shapes"
import { MeshBuilder } from "../mesh"

/**
 * The three ways a piece of art takes its colour.
 *
 * `static` keeps whatever it was drawn with. `main` and `accent` are recoloured
 * at runtime by the component wearing them, which is what lets one thruster
 * design serve a whole fleet. The role is a key in the file, so a baked triangle
 * needs no marker of its own.
 */
export const ART_ROLES = ["static", "main", "accent"] as const
export type ArtRole = (typeof ART_ROLES)[number]

/**
 * The two halves of a piece, drawn base first.
 *
 * Separate from role, and for a different reason: a role decides how a square
 * takes its colour, a layer decides whether it moves. A turret's barrel goes on
 * `top` so it can be rotated or recoiled without dragging its mounting with it.
 */
export const ART_LAYERS = ["base", "top"] as const
export type ArtLayer = (typeof ART_LAYERS)[number]

/**
 * A run of identical cells merged into one rectangle.
 *
 * `cell` is the representative they all agreed with - they share a signature, so
 * any one of them describes the whole run.
 */
export interface ArtRect {
    col: number
    row: number
    /** Inclusive, so a single cell has col2 === col. */
    col2: number
    row2: number
    cell: ArtCell
}

/**
 * Everything that has to match for two cells to merge.
 *
 * Colour is in here because the mesh carries colour per vertex: two adjacent
 * cells of different colours are two different quads however identical their
 * geometry.
 */
function signature(cell: ArtCell): string {
    return `${cell.shape}|${cell.turns}|${cell.mirrored}|${cell.color.hex}`
}

/**
 * Only `full` cells merge.
 *
 * A wedge and the wedge beside it do not add up to a rectangle, and working out
 * which curved pairs happen to tile is a far larger problem than the handful of
 * triangles it would save.
 */
function canMerge(cell: ArtCell): boolean {
    return cell.shape === "full"
}

/**
 * Merges identical neighbours into rectangles.
 *
 * Horizontal runs first, then vertically adjacent runs covering exactly the same
 * columns - the same two passes the old hull compactor used. Component art is
 * mostly solid blocks of one colour, so this is the difference between a 16x16
 * plate costing 512 triangles and costing 2.
 */
export function compactCells(cells: readonly ArtCell[]): ArtRect[] {
    const byRow = new Map<number, ArtCell[]>()
    for (const cell of cells) {
        const row = byRow.get(cell.row) ?? []
        row.push(cell)
        byRow.set(cell.row, row)
    }

    const spans: ArtRect[] = []

    for (const row of byRow.values()) {
        row.sort((a, b) => a.col - b.col)

        let run: ArtRect | null = null
        for (const cell of row) {
            // canMerge on the run as well as the cell: an unmergeable shape opens
            // a run of its own, and the next cell must not extend it
            const continuesRun = run !== null
                && canMerge(cell)
                && canMerge(run.cell)
                && run.col2 + 1 === cell.col
                && signature(run.cell) === signature(cell)

            if (continuesRun && run) {
                run.col2 = cell.col
            } else {
                run = { col: cell.col, row: cell.row, col2: cell.col, row2: cell.row, cell }
                spans.push(run)
            }
        }
    }

    return stackSpans(spans)
}

/** Merges spans covering the same columns down consecutive rows. */
function stackSpans(spans: readonly ArtRect[]): ArtRect[] {
    const stacks = new Map<string, ArtRect[]>()

    for (const span of spans) {
        // An unmergeable shape gets a key nothing else can collide with, so it
        // falls through this pass untouched rather than needing a branch below
        const key = canMerge(span.cell)
            ? `${span.col}|${span.col2}|${signature(span.cell)}`
            : `solo:${span.col}:${span.row}`

        const stack = stacks.get(key) ?? []
        stack.push(span)
        stacks.set(key, stack)
    }

    const out: ArtRect[] = []

    for (const stack of stacks.values()) {
        stack.sort((a, b) => a.row - b.row)

        let start = 0
        for (let i = 1; i <= stack.length; i++) {
            const breaks = i === stack.length || stack[i]!.row !== stack[i - 1]!.row + 1
            if (!breaks) continue

            out.push({ ...stack[start]!, row2: stack[i - 1]!.row })
            start = i
        }
    }

    return out.sort((a, b) => a.row - b.row || a.col - b.col)
}

/**
 * One role's cells as triangles, in unit-cell space.
 *
 * Everything divides by `gridSize`, so a 16x16 canvas bakes into the 0..1 box one
 * hull cell occupies and the runtime only multiplies by its cell size. Vertices
 * are the same five floats the rest of the renderer uses, so a baked sprite needs
 * no vertex format of its own - `main` and `accent` simply have their colour
 * overwritten when the ship mesh is built, and the authored colour stays in the
 * file as a sensible default
 * Takes an already-filtered list - `ArtGrid.ofRole` - rather than filtering
 * here. That is what makes merging across roles impossible by construction
 * instead of by a check inside `signature` that could be forgotten.
 */
export function bakeRole(cells: readonly ArtCell[], gridSize: number): Float32Array<ArrayBuffer> {
    const builder = new MeshBuilder()
    const scale = 1 / gridSize

    for (const rect of compactCells(cells)) {
        const { cell } = rect
        const x = rect.col * scale
        const y = rect.row * scale

        if (canMerge(cell)) {
            const width = (rect.col2 - rect.col + 1) * scale
            const height = (rect.row2 - rect.row + 1) * scale
            builder.quad(x, y, width, height, cell.color)
            continue
        }

        // Never merged, so this rectangle is exactly the one cell it started as
        appendShape(builder, cell.shape, cell.turns, cell.mirrored, x, y, scale, cell.color)
    }

    return builder.toArray()
}

