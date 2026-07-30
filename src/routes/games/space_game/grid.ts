import { CELL_SIZE } from "./helpers";
import { adjustColorForLight, type GridLightInfo } from "./lighting";
import type { Placement } from "./placements";

export type BlockShape = "empty" | "full" | "halfN" | "halfS" | "halfE" | "halfW" | "triSE" | "triSW" | "triNE" | "triNW" | "arcNW" | "arcNE" | "arcSE" | "arcSW"

export interface CellPosition {
    row: number,
    column: number
}

export interface Cell {
    position: CellPosition
    color: string
    shape: BlockShape
    placement: Placement | null
    invertLight?: boolean
}

export const BLOCK_MENU = [
    { shape: "full", label: "Full"},
    { shape: "triNW", label: "Wedge NW" },
    { shape: "triNE", label: "Wedge NE" },
    { shape: "triSE", label: "Wedge SE" },
    { shape: "triSW", label: "Wedge SW" },
    { shape: "arcNW", label: "Arc NW" },
    { shape: "arcNE", label: "Arc NE" },
    { shape: "arcSE", label: "Arc SE" },
    { shape: "arcSW", label: "Arc SW" },
] as const

export class Grid {
    private cellMap: Map<string, Cell> = new Map()
    defaultColor: string = "grey"

    get filledCount(): number {
        return this.cellMap.size
    }

    private key(col: number, row: number): string {
        return `${col},${row}`
    }

    // --- Cell lookups ---------------------------------------------------

    getCell(column: number, row: number): Cell {
        const k = this.key(column, row)
        const existing = this.cellMap.get(k)
        if (existing) return existing

        return {
            position: { row, column },
            shape: "empty",
            color: this.defaultColor,
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

    getFilledBounds(): { minCol: number, maxCol: number, minRow: number, maxRow: number } | null {
        if (this.cellMap.size === 0) return null
        let minCol = Infinity, maxCol = -Infinity
        let minRow = Infinity, maxRow = -Infinity
        for (const cell of this.cellMap.values()) {
            minCol = Math.min(minCol, cell.position.column)
            maxCol = Math.max(maxCol, cell.position.column)
            minRow = Math.min(minRow, cell.position.row)
            maxRow = Math.max(maxRow, cell.position.row)
        }
        return { minCol, maxCol, minRow, maxRow }
    }

    getCenter(): { x: number, y: number } {
        const bounds = this.getFilledBounds()
        if (!bounds) return { x: 0, y: 0 }
        return {
            x: ((bounds.minCol + bounds.maxCol + 1) * CELL_SIZE) / 2,
            y: ((bounds.minRow + bounds.maxRow + 1) * CELL_SIZE) / 2
        }
    }

    getBoundingRadius(): number {
        const center = this.getCenter()
        let maxDistSq = 0
        for (const cell of this.cellMap.values()) {
            const x0 = cell.position.column * CELL_SIZE
            const y0 = cell.position.row * CELL_SIZE
            const x1 = x0 + CELL_SIZE
            const y1 = y0 + CELL_SIZE
            for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
                const dx = px - center.x
                const dy = py - center.y
                maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy)
            }
        }
        return Math.sqrt(maxDistSq) || 1
    }

    // --- Mutation --------------------------------------------------------

    setCell(cell: Cell, shape: BlockShape, color: string, placement: Placement | null) {
        cell.shape = shape
        cell.color = color
        cell.placement = placement

        const k = this.key(cell.position.column, cell.position.row)
        if (shape === "empty") {
            this.cellMap.delete(k)
        } else {
            this.cellMap.set(k, cell)
        }
    }

    clearCell(cell: Cell) {
        cell.shape = "empty"
        cell.placement = null
        this.cellMap.delete(this.key(cell.position.column, cell.position.row))
    }

    forEachFilled(fn: (cell: Cell) => void) {
        for (const cell of this.cellMap.values()) {
            fn(cell)
        }
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

    loadFrom(data: { cells: { r: number, c: number, s: BlockShape, color: string }[] }) {
        this.cellMap.clear()
        for (const entry of data.cells) {
            const cell = this.getCell(entry.c, entry.r)
            this.setCell(cell, entry.s, entry.color, null)
        }
    }

    // --- Drawing ------------------------------------------------------------

    draw(ctx: CanvasRenderingContext2D, zoom: number = 1, showGrid: boolean = false, lightInfo?: GridLightInfo) {
        ctx.save();
        ctx.scale(zoom, zoom);

        const center = lightInfo ? this.getCenter() : undefined

        for (const cell of this.cellMap.values()) {
            this.drawBlock(ctx, cell, lightInfo, center);
        }

        if (showGrid) {
            this.drawGridLines(ctx)
            this.drawCenterCross(ctx)
        }

        ctx.restore();
    }

    drawGhostBlock(ctx: CanvasRenderingContext2D, col: number, row: number, shape: BlockShape, color: string) {
        const x = col * CELL_SIZE
        const y = row * CELL_SIZE
        ctx.save()
        ctx.globalAlpha = 0.35
        ctx.fillStyle = color
        if (shape === "full") {
            ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
        } else if (shape.startsWith("half")) {
            this.drawHalf(ctx, shape as "halfN" | "halfS" | "halfE" | "halfW", x, y, CELL_SIZE)
        } else if (shape.startsWith("arc")) {
            this.drawArc(ctx, shape as "arcNW" | "arcNE" | "arcSE" | "arcSW", x, y, CELL_SIZE)
        } else {
            this.drawTriangle(ctx, shape as "triNW" | "triNE" | "triSW" | "triSE", x, y, CELL_SIZE, CELL_SIZE)
        }
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
                    const x = col * CELL_SIZE
                    const y = row * CELL_SIZE
                    ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE)
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

    private drawBlock(
        ctx: CanvasRenderingContext2D,
        cell: Cell,
        lightInfo?: GridLightInfo,
        center?: { x: number, y: number }
    ) {
        if (cell.shape === "empty") return;

        const x = cell.position.column * CELL_SIZE;
        const y = cell.position.row * CELL_SIZE;

        const baseColor = cell.color ?? "rgba(255, 180, 80, 0.9)";

        if (lightInfo && center) {
            const cellCenterX = x + CELL_SIZE / 2;
            const cellCenterY = y + CELL_SIZE / 2;
            const li = cell.invertLight
                ? { dirX: -lightInfo.dirX, dirY: -lightInfo.dirY, strength: lightInfo.strength }
                : lightInfo;
            ctx.fillStyle = adjustColorForLight(baseColor, cellCenterX, cellCenterY, center.x, center.y, li);
        } else {
            ctx.fillStyle = baseColor;
        }

        if (cell.shape === "full") {
            ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
            return;
        }

        if (cell.shape.startsWith("half")) {
            this.drawHalf(ctx, cell.shape as "halfN" | "halfS" | "halfE" | "halfW", x, y, CELL_SIZE);
            return;
        }

        if (cell.shape.startsWith("arc")) {
            this.drawArc(ctx, cell.shape as "arcNW" | "arcNE" | "arcSE" | "arcSW", x, y, CELL_SIZE);
            return;
        }

        this.drawTriangle(ctx, cell.shape as "triNW" | "triNE" | "triSW" | "triSE", x, y, CELL_SIZE, CELL_SIZE);
    }

    private drawTriangle(
        ctx: CanvasRenderingContext2D,
        shape: "triNW" | "triNE" | "triSW" | "triSE",
        x: number,
        y: number,
        w: number,
        h: number
    ) {
        const NW: [number, number] = [x, y];
        const NE: [number, number] = [x + w, y];
        const SW: [number, number] = [x, y + h];
        const SE: [number, number] = [x + w, y + h];

        let points: [number, number][];

        switch (shape) {
            case "triNW": points = [NW, NE, SW]; break;
            case "triNE": points = [NE, NW, SE]; break;
            case "triSW": points = [SW, NW, SE]; break;
            case "triSE": points = [SE, NE, SW]; break;
        }

        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        ctx.lineTo(points[1][0], points[1][1]);
        ctx.lineTo(points[2][0], points[2][1]);
        ctx.closePath();
        ctx.fill();
    }

    private drawArc(
        ctx: CanvasRenderingContext2D,
        shape: "arcNW" | "arcNE" | "arcSE" | "arcSW",
        x: number,
        y: number,
        size: number
    ) {
        let cx: number, cy: number, startAngle: number, endAngle: number

        switch (shape) {
            case "arcNW":
                cx = x; cy = y
                startAngle = 0; endAngle = Math.PI / 2
                break
            case "arcNE":
                cx = x + size; cy = y
                startAngle = Math.PI / 2; endAngle = Math.PI
                break
            case "arcSE":
                cx = x + size; cy = y + size
                startAngle = Math.PI; endAngle = Math.PI * 1.5
                break
            case "arcSW":
                cx = x; cy = y + size
                startAngle = Math.PI * 1.5; endAngle = Math.PI * 2
                break
        }

        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, size, startAngle, endAngle)
        ctx.closePath()
        ctx.fill()
    }

    private drawHalf(
        ctx: CanvasRenderingContext2D,
        shape: "halfN" | "halfS" | "halfE" | "halfW",
        x: number,
        y: number,
        size: number
    ) {
        const half = size / 2
        switch (shape) {
            case "halfN": ctx.fillRect(x, y, size, half); break
            case "halfS": ctx.fillRect(x, y + half, size, half); break
            case "halfW": ctx.fillRect(x, y, half, size); break
            case "halfE": ctx.fillRect(x + half, y, half, size); break
        }
    }

    // --- Testing / scaffolding ---------------------------------------------

    paintTestShape() {
        const hull = "#8a9ba8"
        const hullDark = "#6b7d8a"
        const cockpit = "#4a9eff"
        const cockpitGlow = "#6ab4ff"
        const accent = "#e07030"
        const engine = "#c85028"
        const exhaust = "#ff9944"

        const set = (row: number, col: number, shape: BlockShape, color?: string) => {
            const cell = this.getCell(col, row);
            this.setCell(cell, shape, color ?? hull, null)
        };

        const fill = (row: number, colFrom: number, colTo: number, color?: string) => {
            for (let c = colFrom; c <= colTo; c++) set(row, c, "full", color)
        };

        // Even-width ship symmetric around the line between cols 4 and 5

        // Nose
        set(0, 4, "full", hullDark);
        set(0, 5, "full", hullDark);

        // Nose widens
        set(1, 3, "triSE", hullDark);
        set(1, 4, "full", cockpitGlow);
        set(1, 5, "full", cockpitGlow);
        set(1, 6, "triSW", hullDark);

        // Cockpit
        set(2, 3, "full", hullDark);
        set(2, 4, "full", cockpit);
        set(2, 5, "full", cockpit);
        set(2, 6, "full", hullDark);

        // Body widens
        set(3, 2, "triSE", hull);
        fill(3, 3, 6);
        set(3, 7, "triSW", hull);

        // Main body
        for (let r = 4; r <= 5; r++) {
            set(r, 2, "full", hull);
            set(r, 3, "full", accent);
            fill(r, 4, 5, hull);
            set(r, 6, "full", accent);
            set(r, 7, "full", hull);
        }

        // Wings expand
        set(6, 1, "triSE", accent);
        set(6, 2, "full", accent);
        fill(6, 3, 6, hull);
        set(6, 7, "full", accent);
        set(6, 8, "triSW", accent);

        // Wings full
        set(7, 1, "full", accent);
        set(7, 2, "full", accent);
        fill(7, 3, 6, hullDark);
        set(7, 7, "full", accent);
        set(7, 8, "full", accent);

        // Wings taper
        set(8, 1, "triNE", accent);
        set(8, 2, "full", accent);
        fill(8, 3, 6, hull);
        set(8, 7, "full", accent);
        set(8, 8, "triNW", accent);

        // Lower body
        for (let r = 9; r <= 10; r++) {
            set(r, 2, "full", hull);
            set(r, 3, "full", hullDark);
            fill(r, 4, 5, hull);
            set(r, 6, "full", hullDark);
            set(r, 7, "full", hull);
        }

        // Engine narrows
        set(11, 2, "triNE", hull);
        set(11, 3, "full", engine);
        fill(11, 4, 5, hullDark);
        set(11, 6, "full", engine);
        set(11, 7, "triNW", hull);

        // Engine
        fill(12, 3, 6, engine);

        // Exhaust
        set(13, 3, "triNE", engine);
        set(13, 4, "full", exhaust);
        set(13, 5, "full", exhaust);
        set(13, 6, "triNW", engine);
    }
}
