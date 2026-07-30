import { CELL_SIZE } from "./helpers"
import { type BlockShape, type Cell, type Grid } from "./grid"
import { Placement, Spike, Thruster, Turret, type PlacementLevel } from "./placements"

export type EditorMode = "blocks" | "placements"

type BaseShape = "full" | "half" | "wedge" | "arc" | "empty"

const WEDGE_ROTATIONS: BlockShape[] = ["triNW", "triNE", "triSE", "triSW"]
const ARC_ROTATIONS: BlockShape[] = ["arcNW", "arcNE", "arcSE", "arcSW"]
const HALF_ROTATIONS: BlockShape[] = ["halfN", "halfE", "halfS", "halfW"]

export class GridEditor {
    grid: Grid
    hoveredCell: Cell | null = null

    editorMode: EditorMode = "blocks"
    baseShape: BaseShape = "full"
    rotationIndex: number = 0
    selectedColor: string = "hsl(0, 0%, 50%)"

    selectedPlacementType: "turret" | "thruster" | "spike" | "erase" | null = null
    selectedPlacement: Placement | null = null
    placementRotationIndex: number = 0

    constructor(grid: Grid) {
        this.grid = grid
    }

    get resolvedShape(): BlockShape | null {
        if (this.baseShape === "empty") return null
        if (this.baseShape === "full") return "full"
        if (this.baseShape === "wedge") return WEDGE_ROTATIONS[this.rotationIndex]
        if (this.baseShape === "arc") return ARC_ROTATIONS[this.rotationIndex]
        if (this.baseShape === "half") return HALF_ROTATIONS[this.rotationIndex]
        return "full"
    }

    get canRotate(): boolean {
        if (this.editorMode === "placements" && this.selectedPlacementType === "spike") return true
        return this.baseShape === "wedge" || this.baseShape === "arc" || this.baseShape === "half"
    }

    selectBaseShape(shape: BaseShape) {
        this.baseShape = shape
        this.rotationIndex = 0
    }

    rotate() {
        if (this.editorMode === "placements" && this.selectedPlacementType === "spike") {
            this.placementRotationIndex = (this.placementRotationIndex + 1) % 4
            return
        }
        if (this.canRotate) {
            this.rotationIndex = (this.rotationIndex + 1) % 4
        }
    }

    get spikeRotation(): number {
        return this.placementRotationIndex * (Math.PI / 2)
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
                turret.color = cell.color
                this.grid.setCell(cell, cell.shape, cell.color, turret)
                this.selectedPlacement = turret
            } else if (this.selectedPlacementType === "thruster") {
                const thruster = new Thruster()
                thruster.cell = cell
                thruster.color = cell.color
                this.grid.setCell(cell, cell.shape, cell.color, thruster)
                this.selectedPlacement = thruster
            } else if (this.selectedPlacementType === "spike") {
                const spike = new Spike()
                spike.cell = cell
                spike.color = cell.color
                spike.rotation = this.spikeRotation
                this.grid.setCell(cell, cell.shape, cell.color, spike)
                this.selectedPlacement = spike
            } else if (this.selectedPlacementType === "erase") {
                if (cell.placement) {
                    this.grid.setCell(cell, cell.shape, cell.color, null)
                }
                this.selectedPlacement = null
            } else {
                this.selectedPlacement = cell.placement ?? null
            }
            return
        }

        const shape = this.resolvedShape
        if (shape === null) {
            this.grid.clearCell(cell)
        } else {
            const col = cell.position.column
            const row = cell.position.row
            if (!this.grid.isFilled(col, row) && !this.grid.hasFilledNeighbor(col, row)) return
            this.grid.setCell(cell, shape, this.selectedColor, cell.placement)
        }
    }

    upgradeSelectedPlacement(): boolean {
        if (!this.selectedPlacement || this.selectedPlacement.level >= 5) return false
        this.selectedPlacement.level = (this.selectedPlacement.level + 1) as PlacementLevel
        return true
    }

    removeSelectedPlacement() {
        if (!this.selectedPlacement?.cell) return
        const cell = this.selectedPlacement.cell
        this.grid.setCell(cell, cell.shape, cell.color, null)
        this.selectedPlacement = null
    }
}
