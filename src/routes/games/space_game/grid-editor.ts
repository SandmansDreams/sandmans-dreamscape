import { CELL_SIZE } from "./helpers"
import { type BlockShape, type Cell, type Grid } from "./grid"
import { Placement, Turret } from "./placements"

export type EditorMode = "blocks" | "placements"

type BaseShape = "full" | "wedge" | "arc" | "empty"

const WEDGE_ROTATIONS: BlockShape[] = ["triNW", "triNE", "triSE", "triSW"]
const ARC_ROTATIONS: BlockShape[] = ["arcNW", "arcNE", "arcSE", "arcSW"]

export class GridEditor {
    grid: Grid
    hoveredCell: Cell | null = null

    editorMode: EditorMode = "blocks"
    baseShape: BaseShape = "full"
    rotationIndex: number = 0
    selectedColor: string = "hsl(0, 0%, 50%)"

    selectedPlacementType: "turret" | null = null

    constructor(grid: Grid) {
        this.grid = grid
    }

    get resolvedShape(): BlockShape | null {
        if (this.baseShape === "empty") return null
        if (this.baseShape === "full") return "full"
        if (this.baseShape === "wedge") return WEDGE_ROTATIONS[this.rotationIndex]
        if (this.baseShape === "arc") return ARC_ROTATIONS[this.rotationIndex]
        return "full"
    }

    get canRotate(): boolean {
        return this.baseShape === "wedge" || this.baseShape === "arc"
    }

    selectBaseShape(shape: BaseShape) {
        this.baseShape = shape
        this.rotationIndex = 0
    }

    rotate() {
        if (this.canRotate) {
            this.rotationIndex = (this.rotationIndex + 1) % 4
        }
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

        if (this.editorMode === "placements") {
            if (cell.shape === "empty") return
            if (this.selectedPlacementType === "turret") {
                const turret = new Turret()
                turret.cell = cell
                this.grid.setCell(cell, cell.shape, cell.color, turret)
            } else {
                this.grid.setCell(cell, cell.shape, cell.color, null)
            }
            return
        }

        const shape = this.resolvedShape
        if (shape === null) {
            this.grid.clearCell(cell)
        } else {
            this.grid.setCell(cell, shape, this.selectedColor, cell.placement)
        }
    }
}
