import type { Placement } from "./placements";

export type BlockShape = "empty" | "full" | "triSE" | "triSW" | "triNE" | "triNW"

export interface CellPosition {
    row: number,
    column: number
}

export interface Cell {
    position: CellPosition
    color: string
    shape: BlockShape
    placement: Placement | null
}

export const BLOCK_MENU = [
    { shape: "full", label: "Full"},
    { shape: "triNW", label: "Wedge NW" },
    { shape: "triNE", label: "Wedge NE" },
    { shape: "triSE", label: "Wedge SE" },
    { shape: "triSW", label: "Wedge SW" },
] as const

export class ShipGrid {
    readonly cols: number
    readonly rows: number
    readonly cells: Cell[][]
    defaultColor: string = "grey"
    private _filledCount: number = 0

    constructor(
        public width: number,
        public height: number,
        public cellSize: number
    ) {
        this.cols = Math.ceil(width / cellSize);
        this.rows = Math.ceil(height / cellSize);

        this.cells = Array.from({ length: this.rows }, (_, row) =>
            Array.from({ length: this.cols }, (_, column) => ({
                position: { row, column },
                shape: "empty" as BlockShape,
                color: this.defaultColor,
                placement: null
            }))
        );
    }

    get filledCount(): number {
        return this._filledCount
    }

    // --- Cell lookups ---------------------------------------------------

    getCell(column: number, row: number): Cell | null {
        if (
            row < 0 ||
            row >= this.rows ||
            column < 0 ||
            column >= this.cols
        ) {
            return null;
        }

        return this.cells[row][column];
    }

    getCellFromPoint(x: number, y: number): Cell | null {
        return this.getCell(
            Math.floor(x / this.cellSize),
            Math.floor(y / this.cellSize)
        );
    }

    // --- Mutation --------------------------------------------------------

    setCell(cell: Cell, shape: BlockShape, color: string, placement: Placement | null) {
        const wasFilled = cell.shape !== "empty"

        cell.shape = shape
        cell.color = color
        cell.placement = placement

        const isFilled = shape !== "empty"
        if (!wasFilled && isFilled) this._filledCount++
        if (wasFilled && !isFilled) this._filledCount--
    }

    clearCell(cell: Cell) {
        if (cell.shape !== "empty") this._filledCount--
        cell.shape = "empty"
        cell.placement = null
    }

    // --- Drawing ------------------------------------------------------------

    draw(ctx: CanvasRenderingContext2D, zoom: number = 1) {
        ctx.save();
        ctx.scale(zoom, zoom);

        for (const row of this.cells) {
            for (const cell of row) {
                this.drawCell(ctx, cell);
            }
        }

        ctx.restore();
    }

    private drawCell(
        ctx: CanvasRenderingContext2D,
        cell: Cell
    ) {
        const strokeStyle = "rgba(105, 208, 255, 0.1)"

        const x = cell.position.column * this.cellSize;
        const y = cell.position.row * this.cellSize;

        if (cell.shape !== "empty") {
            this.drawBlock(ctx, cell);
        }

        ctx.strokeStyle = strokeStyle;
        ctx.strokeRect(x, y, this.cellSize, this.cellSize);

        this.drawCellCoordinates(ctx, cell, strokeStyle);

        ctx.fillStyle = "rgba(0, 0, 0, 0)";
        ctx.strokeStyle = "rgba(0, 0, 0, 0)";
    }

    private drawCellCoordinates(
        ctx: CanvasRenderingContext2D,
        cell: Cell,
        fillStyle: string
    ) {
        const scale = this.cellSize / 5;
        const x = cell.position.column * this.cellSize + 5;
        const y = cell.position.row * this.cellSize + 12;

        ctx.fillStyle = fillStyle;
        ctx.font = `${scale}px Arial`;
        ctx.fillText(`(${cell.position.column}, ${cell.position.row})`, x, y);
    }

    private drawBlock(
        ctx: CanvasRenderingContext2D,
        cell: Cell
    ) {
        if (cell.shape === "empty") return;

        const x = cell.position.column * this.cellSize;
        const y = cell.position.row * this.cellSize;

        ctx.fillStyle = cell.color ?? "rgba(255, 180, 80, 0.9)";

        if (cell.shape === "full") {
            ctx.fillRect(x, y, this.cellSize, this.cellSize);
            return;
        }

        this.drawTriangle(ctx, cell.shape, x, y, this.cellSize, this.cellSize);
    }

    private drawTriangle(
        ctx: CanvasRenderingContext2D,
        shape: Exclude<BlockShape, "full" | "empty">,
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
            default: {
                const exhaustiveCheck: never = shape;
                throw new Error(`Unhandled block shape: ${exhaustiveCheck}`);
            }
        }

        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        ctx.lineTo(points[1][0], points[1][1]);
        ctx.lineTo(points[2][0], points[2][1]);
        ctx.closePath();
        ctx.fill();
    }

    // --- Testing / scaffolding ---------------------------------------------

    paintTestShape() {
        const set = (row: number, column: number, shape: BlockShape) => {
            const cell = this.getCell(column, row);
            if (!cell) return;
            this.setCell(cell, shape, this.defaultColor, null)
        };

        const cy = Math.floor(this.rows / 2);
        const cx = Math.floor(this.cols / 2);

        set(cy, cx, "full");
        set(cy, cx - 1, "full");
        set(cy - 1, cx - 1, "triSE");
        set(cy - 1, cx, "triSW");
        set(cy + 1, cx - 1, "triNE");
        set(cy + 1, cx, "triNW");
    }
}