import { type BlockShape, type Cell, type ShipGrid } from "./builder"
import type { Placement } from "./placements"

export class GridEditor {
    grid: ShipGrid
    hoveredCell: Cell | null = null

    selectedShape: BlockShape | null = "full"
    selectedPlacement: Placement | null = null
    selectedColor: string = "rgba(255, 180, 80, 0.9)"

    constructor(grid: ShipGrid) {
        this.grid = grid
    }

    selectShape(shape: BlockShape | null) {
        this.selectedShape = shape
    }

    selectColor(color: string) {
        this.selectedColor = color
    }

    handleMouseMove(x: number, y: number) {
        this.hoveredCell = this.grid.getCellFromPoint(x, y)
    }

    handleMouseLeave() {
        this.hoveredCell = null
    }

    handleClick(x: number, y: number) {
        const cell = this.grid.getCellFromPoint(x, y)

        if (this.selectedShape === null) {
            this.grid.clearCell(cell)
        } else {
            this.grid.setCell(cell, this.selectedShape, this.selectedColor, this.selectedPlacement)
        }
    }
}
