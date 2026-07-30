import { CELL_SIZE } from "./helpers";
import { illuminationAt, internColor, type SurfaceLight } from "./lighting";
import type { Placement } from "./placements";
import { fillBlockShape, type BlockShape } from "./shapes";

export { BLOCK_MENU, fillBlockShape, type BlockShape } from "./shapes";

export interface CellPosition {
    row: number,
    column: number
}

export interface Cell {
    position: CellPosition
    color: string
    /** Interned id of `color`, kept in sync by setCell so shading never parses strings. */
    colorId: number
    shape: BlockShape
    placement: Placement | null
    /** Flips the shading direction — used to make crater floors read as concave. */
    invertLight?: boolean
}

interface Bounds {
    minCol: number
    maxCol: number
    minRow: number
    maxRow: number
}

const HALF_CELL = CELL_SIZE / 2

export class Grid {
    private cellMap: Map<string, Cell> = new Map()
    defaultColor: string = "grey"

    /**
     * Bumped by every mutation. Derived data (the flat cell list, bounds,
     * centre, bounding radius) is recomputed lazily when it falls behind.
     *
     * All of those used to be recomputed from scratch on every access, and
     * they are read several times per entity per frame — from Grid.draw,
     * Ship.cellToWorld, health bars and collider sizing — so they dominated
     * the frame before being cached.
     */
    private version = 0

    private cellsVersion = -1
    private cellList: Cell[] = []

    private boundsVersion = -1
    private cachedBounds: Bounds | null = null

    private centerVersion = -1
    private cachedCenter = { x: 0, y: 0 }

    private radiusVersion = -1
    private cachedRadius = 1

    private placedVersion = -1
    private placedList: Cell[] = []

    get filledCount(): number {
        return this.cellMap.size
    }

    /** Increments on every mutation. Callers cache derived data against it. */
    get revision(): number {
        return this.version
    }

    private key(col: number, row: number): string {
        return `${col},${row}`
    }

    private invalidate() {
        this.version++
    }

    // --- Cell lookups ---------------------------------------------------

    getCell(column: number, row: number): Cell {
        const existing = this.cellMap.get(this.key(column, row))
        if (existing) return existing

        return {
            position: { row, column },
            shape: "empty",
            color: this.defaultColor,
            colorId: internColor(this.defaultColor),
            placement: null
        }
    }

    isFilled(col: number, row: number): boolean {
        return this.cellMap.has(this.key(col, row))
    }

    hasFilledNeighbor(col: number, row: number): boolean {
        return this.isFilled(col - 1, row) ||
            this.isFilled(col + 1, row) ||
            this.isFilled(col, row - 1) ||
            this.isFilled(col, row + 1)
    }

    getCellFromPoint(x: number, y: number): Cell {
        return this.getCell(
            Math.floor(x / CELL_SIZE),
            Math.floor(y / CELL_SIZE)
        )
    }

    /**
     * Filled cells as a flat array, sorted by colour.
     *
     * Sorting is what makes the batched draw loop worthwhile: cells sharing a
     * base colour end up adjacent, so consecutive cells usually resolve to the
     * same shaded string and the fillStyle write can be skipped. Shapes never
     * leave their own cell, so reordering cannot change the result.
     */
    get cells(): Cell[] {
        if (this.cellsVersion !== this.version) {
            this.cellList.length = 0
            for (const cell of this.cellMap.values()) this.cellList.push(cell)
            this.cellList.sort(byColorId)
            this.cellsVersion = this.version
        }
        return this.cellList
    }

    /**
     * Only the cells carrying a placement.
     *
     * Turret/thruster updates and draws walk this instead of every filled
     * cell, which on a large hull is a small fraction of the grid.
     */
    get placedCells(): Cell[] {
        if (this.placedVersion !== this.version) {
            this.placedList.length = 0
            for (const cell of this.cells) {
                if (cell.placement) this.placedList.push(cell)
            }
            this.placedVersion = this.version
        }
        return this.placedList
    }

    getFilledBounds(): Bounds | null {
        if (this.boundsVersion === this.version) return this.cachedBounds

        this.boundsVersion = this.version

        if (this.cellMap.size === 0) {
            this.cachedBounds = null
            return null
        }

        let minCol = Infinity, maxCol = -Infinity
        let minRow = Infinity, maxRow = -Infinity
        for (const cell of this.cellMap.values()) {
            const { column, row } = cell.position
            if (column < minCol) minCol = column
            if (column > maxCol) maxCol = column
            if (row < minRow) minRow = row
            if (row > maxRow) maxRow = row
        }

        this.cachedBounds = { minCol, maxCol, minRow, maxRow }
        return this.cachedBounds
    }

    /**
     * Centre of the filled area, in grid units.
     *
     * The returned object is cached and reused — treat it as read-only.
     */
    getCenter(): { x: number, y: number } {
        if (this.centerVersion === this.version) return this.cachedCenter

        this.centerVersion = this.version

        const bounds = this.getFilledBounds()
        if (!bounds) {
            this.cachedCenter = { x: 0, y: 0 }
            return this.cachedCenter
        }

        this.cachedCenter = {
            x: ((bounds.minCol + bounds.maxCol + 1) * CELL_SIZE) / 2,
            y: ((bounds.minRow + bounds.maxRow + 1) * CELL_SIZE) / 2
        }
        return this.cachedCenter
    }

    /**
     * Extent of the filled area in grid units.
     *
     * Centred on getCenter(), which is where entities place their origin, so
     * this doubles as the dimensions of a hull-tight box collider.
     */
    getFilledSize(): { width: number, height: number } {
        const bounds = this.getFilledBounds()
        if (!bounds) return { width: 0, height: 0 }

        return {
            width: (bounds.maxCol - bounds.minCol + 1) * CELL_SIZE,
            height: (bounds.maxRow - bounds.minRow + 1) * CELL_SIZE
        }
    }

    getBoundingRadius(): number {
        if (this.radiusVersion === this.version) return this.cachedRadius

        this.radiusVersion = this.version

        const center = this.getCenter()
        let maxDistSq = 0

        for (const cell of this.cellMap.values()) {
            const x0 = cell.position.column * CELL_SIZE
            const y0 = cell.position.row * CELL_SIZE

            // Only the corner diagonally opposite the centre can be the
            // farthest, so test the two candidate x's against the two y's.
            const dx = Math.max(Math.abs(x0 - center.x), Math.abs(x0 + CELL_SIZE - center.x))
            const dy = Math.max(Math.abs(y0 - center.y), Math.abs(y0 + CELL_SIZE - center.y))

            const distSq = dx * dx + dy * dy
            if (distSq > maxDistSq) maxDistSq = distSq
        }

        this.cachedRadius = Math.sqrt(maxDistSq) || 1
        return this.cachedRadius
    }

    // --- Mutation --------------------------------------------------------

    setCell(cell: Cell, shape: BlockShape, color: string, placement: Placement | null) {
        cell.shape = shape
        if (cell.color !== color) {
            cell.color = color
            cell.colorId = internColor(color)
        }
        cell.placement = placement

        const k = this.key(cell.position.column, cell.position.row)
        if (shape === "empty") {
            this.cellMap.delete(k)
        } else {
            this.cellMap.set(k, cell)
        }

        this.invalidate()
    }

    clearCell(cell: Cell) {
        cell.shape = "empty"
        cell.placement = null
        this.cellMap.delete(this.key(cell.position.column, cell.position.row))
        this.invalidate()
    }

    forEachFilled(fn: (cell: Cell) => void) {
        const cells = this.cells
        for (let i = 0; i < cells.length; i++) fn(cells[i])
    }

    // --- Serialization -------------------------------------------------------

    serialize(): object {
        const cells: { r: number, c: number, s: BlockShape, color: string }[] = []
        for (const cell of this.cellMap.values()) {
            cells.push({
                r: cell.position.row,
                c: cell.position.column,
                s: cell.shape,
                color: cell.color
            })
        }
        return {
            version: 1,
            cells
        }
    }

    loadFrom(data: { cells?: { r: number, c: number, s: BlockShape, color: string }[] }) {
        if (!Array.isArray(data?.cells)) {
            throw new Error("Grid.loadFrom: payload has no `cells` array")
        }

        this.cellMap.clear()
        this.invalidate()

        for (const entry of data.cells) {
            const cell = this.getCell(entry.c, entry.r)
            this.setCell(cell, entry.s, entry.color, null)
        }
    }

    // --- Drawing ------------------------------------------------------------

    /**
     * Draws every filled cell.
     *
     * @param light shading for this entity, sampled once per frame by the
     *        lighting environment. Omit it to draw flat base colours.
     */
    draw(ctx: CanvasRenderingContext2D, zoom: number = 1, showGrid: boolean = false, light?: SurfaceLight) {
        ctx.save();
        if (zoom !== 1) ctx.scale(zoom, zoom);

        if (light) {
            this.drawLit(ctx, light)
        } else {
            this.drawFlat(ctx)
        }

        if (showGrid) {
            this.drawGridLines(ctx)
            this.drawCenterCross(ctx)
        }

        ctx.restore();
    }

    private drawFlat(ctx: CanvasRenderingContext2D) {
        const cells = this.cells
        let lastStyle = ""

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            if (cell.color !== lastStyle) {
                ctx.fillStyle = cell.color
                lastStyle = cell.color
            }
            fillBlockShape(
                ctx,
                cell.shape,
                cell.position.column * CELL_SIZE,
                cell.position.row * CELL_SIZE,
                CELL_SIZE
            )
        }
    }

    private drawLit(ctx: CanvasRenderingContext2D, light: SurfaceLight) {
        const cells = this.cells
        const center = this.getCenter()
        const centerX = center.x
        const centerY = center.y
        const palette = light.palette

        // Shaded colour strings are interned by the palette, so identical
        // shades are the same string instance and this stays a pointer compare.
        let lastStyle = ""

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            const x = cell.position.column * CELL_SIZE
            const y = cell.position.row * CELL_SIZE

            const illumination = illuminationAt(
                light,
                x + HALF_CELL - centerX,
                y + HALF_CELL - centerY,
                cell.invertLight === true
            )

            const style = palette.shade(cell.colorId, illumination)
            if (style !== lastStyle) {
                ctx.fillStyle = style
                lastStyle = style
            }

            fillBlockShape(ctx, cell.shape, x, y, CELL_SIZE)
        }
    }

    drawGhostBlock(ctx: CanvasRenderingContext2D, col: number, row: number, shape: BlockShape, color: string) {
        ctx.save()
        ctx.globalAlpha = 0.35
        ctx.fillStyle = color
        fillBlockShape(ctx, shape, col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE)
        ctx.restore()
    }

    private drawGridLines(ctx: CanvasRenderingContext2D) {
        const bounds = this.getFilledBounds()
        if (!bounds) return

        const pad = 2
        const startCol = bounds.minCol - pad
        const endCol = bounds.maxCol + pad
        const startRow = bounds.minRow - pad
        const endRow = bounds.maxRow + pad

        ctx.strokeStyle = "rgba(105, 208, 255, 0.1)"
        ctx.lineWidth = 0.5

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                if (this.isFilled(col, row) || this.hasFilledNeighbor(col, row)) {
                    ctx.strokeRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE)
                }
            }
        }
    }

    private drawCenterCross(ctx: CanvasRenderingContext2D) {
        const center = this.getCenter()
        const arm = CELL_SIZE * 1.5

        ctx.strokeStyle = "#ff8c00"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(center.x - arm, center.y)
        ctx.lineTo(center.x + arm, center.y)
        ctx.moveTo(center.x, center.y - arm)
        ctx.lineTo(center.x, center.y + arm)
        ctx.stroke()
    }
}

function byColorId(a: Cell, b: Cell): number {
    return a.colorId - b.colorId
}
