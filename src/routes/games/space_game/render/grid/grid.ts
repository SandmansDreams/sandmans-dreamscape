// A sparse map of blocks on an integer lattice. No units, no GPU.

import { Assert } from "../../assert"
import type { Vec2 } from "../camera"
import { Color } from "../color"
import { normalizeTurns, type BlockShape } from "./shapes"
import { DEFAULT_TYPE, kindOf, statsFor, type ComponentKind } from "./components"
import type { ShipLayer } from "./layers"

const DEFAULT_COLOR = Color.gray(0.6)

/*
 * Cells are keyed by a packed integer rather than a "col,row" string, because
 * lookups happen per cell per rebuild and a string key allocates every time.
 * The offset shifts negative coordinates into the positive range first.
 */
const KEY_OFFSET = 0x8000
const KEY_MAX = 0x7fff

function cellKey(col: number, row: number): number {
    return ((col + KEY_OFFSET) << 16) | (row + KEY_OFFSET)
}

export interface Cell {
    readonly col: number
    readonly row: number

    // Geometry: changing any of these must bump geometryRevision
    shape: BlockShape
    turns: number
    mirrored: boolean
    color: Color
    /** 0 = unlit, 1 = fully emissive. Nothing reads this until post-processing. */
    emission: number

    // Gameplay: changing these bumps revision only
    /**
     * Which component this is, as a registry id.
     *
     * A string rather than the Component itself so a cell stays plain data: the
     * file format writes it, an undo snapshot copies it, and neither has to know
     * the registry exists. `kindOf` is the lookup when the category is what you
     * actually wanted.
     */
    type: string
    level: number
    hitPoints: number
    mass: number
    /**
     * Which edge a component points at, 0-3 as N/E/S/W.
     *
     * Deliberately separate from `turns`: that is folded by the shape's symmetry,
     * so a component drawn with a symmetric shape would have its direction erased.
     * A thruster's facing is a property of the thruster, not of its art.
     */
    facing: number
}

export interface CellOptions {
    turns?: number
    mirrored?: boolean
    color?: Color
    emission?: number
    /** A registry id. Anything unknown falls back to the default type's stats. */
    type?: string
    /** 1-based. Clamped to the levels the type actually has. */
    level?: number
    /** Overrides the level's default. */
    hitPoints?: number
    /** Overrides the level's default. Forced to 0 on the cosmetic layer. */
    mass?: number
    /** 0-3 as N/E/S/W. Not folded by the shape, unlike `turns`. */
    facing?: number
}

/** Inclusive cell indices. */
export interface GridBounds {
    minCol: number
    minRow: number
    maxCol: number
    maxRow: number
}

export class Grid {
    private readonly cells = new Map<number, Cell>()

    private version = 0
    private geometryVersion = 0

    // Derived data, each memoized against the version it was built from
    private cachedList: Cell[] = []
    private listVersion = -1
    private cachedBounds: GridBounds | null = null
    private boundsVersion = -1
    private cachedByKind = new Map<ComponentKind, Cell[]>()
    private byKindVersion = -1

    readonly layer: ShipLayer

    constructor(layer: ShipLayer = "hull") {
        this.layer = layer
    }

    /** Bumped by every mutation. Gameplay systems key off this. */
    get revision(): number {
        return this.version
    }

    /**
     * Bumped only when something the mesh depends on changes: shape, turns,
     * mirrored, color, or a cell appearing or disappearing.
     *
     * Damage mutates hit points every frame. Without this split the mesh cache
     * would re-tessellate the whole ship on every hit.
     */
    get geometryRevision(): number {
        return this.geometryVersion
    }

    get size(): number {
        return this.cells.size
    }

    get centerOfMass(): Vec2 {
        let total = 0
        let x = 0
        let y = 0

        for (const cell of this.cells.values()) {
            if (cell.mass <= 0) continue
            // Cell centers, not corners: a cell at column 0 spans 0 to 1
            total += cell.mass
            x += (cell.col + 0.5) * cell.mass
            y += (cell.row + 0.5) * cell.mass
        }

        return total === 0 ? this.center : { x: x / total, y: y / total }
    }

    set(col: number, row: number, shape: BlockShape, options: CellOptions = {}): Cell {
        Assert.that(
            Number.isInteger(col) && Number.isInteger(row),
            `cell (${col}, ${row}) must be at integer coordinates`,
        )
        Assert.that(
            Math.abs(col) <= KEY_MAX && Math.abs(row) <= KEY_MAX,
            `cell (${col}, ${row}) is outside the packable range of ±${KEY_MAX}`,
        )

        const type = options.type ?? DEFAULT_TYPE
        const level = options.level ?? 1
        const defaults = statsFor(type, level)

        // Cosmetics are free by design - the doc's rule is not to punish a player
        // for wanting their ship to look good, so this is enforced here rather
        // than trusted to every caller
        const mass = this.layer === "cosmetic" ? 0 : options.mass ?? defaults.mass

        const cell: Cell = {
            col,
            row,
            shape,
            turns: normalizeTurns(shape, options.turns ?? 0),
            mirrored: options.mirrored ?? false,
            color: options.color ?? DEFAULT_COLOR,
            emission: options.emission ?? 0,
            type,
            level,
            hitPoints: options.hitPoints ?? defaults.hitPoints,
            mass,
            // Wrapped to 0-3 but NOT folded by the shape: a component's facing is
            // its own property, not a consequence of whatever art represents it
            facing: (((options.facing ?? 0) % 4) + 4) % 4,
        }

        this.cells.set(cellKey(col, row), cell)
        this.version++
        this.geometryVersion++
        return cell
    }

    /** Inclusive on both corners, so fill(0, 0, 2, 0) writes three cells. */
    fill(
        minCol: number,
        minRow: number,
        maxCol: number,
        maxRow: number,
        shape: BlockShape,
        options: CellOptions = {},
    ): void {
        // Tolerate reversed corners rather than silently writing nothing
        const fromCol = Math.min(minCol, maxCol)
        const toCol = Math.max(minCol, maxCol)
        const fromRow = Math.min(minRow, maxRow)
        const toRow = Math.max(minRow, maxRow)

        for (let row = fromRow; row <= toRow; row++) {
            for (let col = fromCol; col <= toCol; col++) this.set(col, row, shape, options)
        }
    }

    get(col: number, row: number): Cell | undefined {
        return this.cells.get(cellKey(col, row))
    }

    has(col: number, row: number): boolean {
        return this.cells.has(cellKey(col, row))
    }

    delete(col: number, row: number): boolean {
        const removed = this.cells.delete(cellKey(col, row))
        if (removed) {
            this.version++
            this.geometryVersion++
        }
        return removed
    }

    clear(): void {
        if (this.cells.size === 0) return
        this.cells.clear()
        this.version++
        this.geometryVersion++
    }

    /** True when any of the four orthogonal neighbors is occupied. */
    hasNeighbor(col: number, row: number): boolean {
        return (
            this.has(col + 1, row) ||
            this.has(col - 1, row) ||
            this.has(col, row + 1) ||
            this.has(col, row - 1)
        )
    }

    /**
     * Reduces a cell's hit points, floored at zero.
     *
     * Bumps `revision` but NOT `geometryRevision` - a damaged block looks the
     * same until something deletes it or recolors it.
     *
     * @returns hit points remaining, or 0 when there is no cell there
     */
    damage(col: number, row: number, amount: number): number {
        const cell = this.get(col, row)
        if (!cell) return 0

        cell.hitPoints = Math.max(0, cell.hitPoints - amount)
        this.version++
        return cell.hitPoints
    }

    /** Call after mutating a cell's gameplay fields directly. */
    touch(): void {
        this.version++
    }

    /** Call after mutating a cell's shape, turns, mirrored or color directly. */
    touchGeometry(): void {
        this.version++
        this.geometryVersion++
    }

    /** Occupied cells as a flat array. Treat as read-only. */
    get list(): readonly Cell[] {
        if (this.listVersion !== this.version) {
            this.cachedList = [...this.cells.values()]
            this.listVersion = this.version
        }
        return this.cachedList
    }

    /** Inclusive bounds, or null when the grid is empty. */
    get bounds(): GridBounds | null {
        if (this.boundsVersion === this.version) return this.cachedBounds

        let result: GridBounds | null = null

        for (const cell of this.cells.values()) {
            if (!result) {
                result = { minCol: cell.col, minRow: cell.row, maxCol: cell.col, maxRow: cell.row }
                continue
            }
            if (cell.col < result.minCol) result.minCol = cell.col
            if (cell.col > result.maxCol) result.maxCol = cell.col
            if (cell.row < result.minRow) result.minRow = cell.row
            if (cell.row > result.maxRow) result.maxRow = cell.row
        }

        this.cachedBounds = result
        this.boundsVersion = this.version
        return result
    }

    /**
     * center in cell units.
     *
     * Offset by one because bounds are inclusive cell indices: a single cell at
     * column 0 spans 0 to 1, so its center is 0.5, not 0.
     */
    get center(): Vec2 {
        const bounds = this.bounds
        if (!bounds) return { x: 0, y: 0 }

        return {
            x: (bounds.minCol + bounds.maxCol + 1) / 2,
            y: (bounds.minRow + bounds.maxRow + 1) / 2,
        }
    }

    /** Size in whole cells. */
    get extent(): { width: number; height: number } {
        const bounds = this.bounds
        if (!bounds) return { width: 0, height: 0 }

        return {
            width: bounds.maxCol - bounds.minCol + 1,
            height: bounds.maxRow - bounds.minRow + 1,
        }
    }

    /**
     * Every cell of one category, so "where are the thrusters" is a lookup not a scan.
     *
     * Bucketed by category rather than by type because that is the question the
     * game asks: thrust comes from every thruster, whatever model it is.
     */
    ofKind(kind: ComponentKind): readonly Cell[] {
        if (this.byKindVersion !== this.version) {
            this.cachedByKind = new Map()
            for (const cell of this.cells.values()) {
                const cellKind = kindOf(cell.type)
                const bucket = this.cachedByKind.get(cellKind)
                if (bucket) bucket.push(cell)
                else this.cachedByKind.set(cellKind, [cell])
            }
            this.byKindVersion = this.version
        }
        return this.cachedByKind.get(kind) ?? []
    }

    /** Sum of every cell's mass. */
    get mass(): number {
        let total = 0
        for (const cell of this.cells.values()) total += cell.mass
        return total
    }
}

