import { type Cell, type Grid } from "./grid"
import type { BlockShape } from "./shapes"
import { Placement, Spike, Thruster, Turret, type PlacementLevel } from "./placements"

export type EditorMode = "blocks" | "placements"

export type BaseShape = "full" | "half" | "wedge" | "arc" | "empty"

export type PlacementTool = "turret" | "thruster" | "spike" | "erase"

const WEDGE_ROTATIONS: BlockShape[] = ["triNW", "triNE", "triSE", "triSW"]
const ARC_ROTATIONS: BlockShape[] = ["arcNW", "arcNE", "arcSE", "arcSW"]
const HALF_ROTATIONS: BlockShape[] = ["halfN", "halfE", "halfS", "halfW"]

/** Shapes that have four rotational variants, and the variants themselves. */
const ROTATABLE: Partial<Record<BaseShape, BlockShape[]>> = {
    wedge: WEDGE_ROTATIONS,
    arc: ARC_ROTATIONS,
    half: HALF_ROTATIONS
}

/** Placement tools that construct something, keyed by tool name. */
const PLACEMENT_FACTORIES: Record<Exclude<PlacementTool, "erase">, () => Placement> = {
    turret: () => new Turret(),
    thruster: () => new Thruster(),
    spike: () => new Spike()
}

export class GridEditor {
    grid: Grid
    hoveredCell: Cell | null = null

    editorMode: EditorMode = "blocks"
    baseShape: BaseShape = "full"
    rotationIndex: number = 0
    selectedColor: string = "hsl(0, 0%, 50%)"

    selectedPlacementType: PlacementTool | null = null
    selectedPlacement: Placement | null = null
    placementRotationIndex: number = 0

    constructor(grid: Grid) {
        this.grid = grid
    }

    get resolvedShape(): BlockShape | null {
        if (this.baseShape === "empty") return null
        return ROTATABLE[this.baseShape]?.[this.rotationIndex] ?? "full"
    }

    private get rotatingPlacement(): boolean {
        return this.editorMode === "placements" && this.selectedPlacementType === "spike"
    }

    get canRotate(): boolean {
        return this.rotatingPlacement || this.baseShape in ROTATABLE
    }

    selectBaseShape(shape: BaseShape) {
        this.baseShape = shape
        this.rotationIndex = 0
    }

    rotate() {
        if (this.rotatingPlacement) {
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

    /**
     * A throwaway instance of the selected module, for drawing the hover ghost.
     *
     * Reusing the real Placement.draw keeps the preview honest — the ghost and
     * the placed module can't drift apart the way hand-drawn previews did.
     */
    get ghostPlacement(): Placement | null {
        const tool = this.selectedPlacementType
        if (tool === null || tool === "erase") return null

        if (!this.ghost || this.ghostTool !== tool) {
            this.ghost = PLACEMENT_FACTORIES[tool]()
            this.ghostTool = tool
        }

        this.ghost.rotation = this.ghost instanceof Spike ? this.spikeRotation : 0
        return this.ghost
    }

    private ghost: Placement | null = null
    private ghostTool: PlacementTool | null = null

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
            this.applyPlacementTool(cell)
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

    /**
     * Applies the active module tool to a cell. Modules can only sit on hull,
     * so empty cells are ignored; with no tool selected a click just selects
     * whatever is already there.
     */
    private applyPlacementTool(cell: Cell) {
        if (cell.shape === "empty") return

        const tool = this.selectedPlacementType

        if (tool === null) {
            this.selectedPlacement = cell.placement ?? null
            return
        }

        if (tool === "erase") {
            if (cell.placement) this.grid.setCell(cell, cell.shape, cell.color, null)
            this.selectedPlacement = null
            return
        }

        const placement = PLACEMENT_FACTORIES[tool]()
        placement.cell = cell
        placement.color = cell.color
        if (placement instanceof Spike) placement.rotation = this.spikeRotation

        this.grid.setCell(cell, cell.shape, cell.color, placement)
        this.selectedPlacement = placement
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
