import { type Cell, type Grid } from "./grid"
import type { BlockShape } from "./shapes"
import { PLACEMENT_FACTORIES, Placement, Spike, type PlacementLevel } from "./placements"

export type EditorMode = "blocks" | "placements"

export type BaseShape = "full" | "half" | "quarter" | "wedge" | "ramp" | "arc" | "empty"

export type PlacementTool = "turret" | "thruster" | "spike" | "erase"

const WEDGE_ROTATIONS: BlockShape[] = ["triNW", "triNE", "triSE", "triSW"]
const ARC_ROTATIONS: BlockShape[] = ["arcNW", "arcNE", "arcSE", "arcSW"]
const HALF_ROTATIONS: BlockShape[] = ["halfN", "halfE", "halfS", "halfW"]
const QUARTER_ROTATIONS: BlockShape[] = ["quarterNW", "quarterNE", "quarterSE", "quarterSW"]

/**
 * Ramps cycle through a full turn and then the mirrored hand of the same
 * slope, because rotation alone can never produce a mirror image and a
 * symmetric hull needs both.
 */
const RAMP_ROTATIONS: BlockShape[] = [
    "rampSE", "rampWS", "rampNW", "rampEN",
    "rampSW", "rampWN", "rampNE", "rampES"
]

/** Shapes with rotational variants. The list length sets the [R] cycle. */
const ROTATABLE: Partial<Record<BaseShape, BlockShape[]>> = {
    half: HALF_ROTATIONS,
    quarter: QUARTER_ROTATIONS,
    wedge: WEDGE_ROTATIONS,
    ramp: RAMP_ROTATIONS,
    arc: ARC_ROTATIONS
}

/** Spikes are free to point at any of eight headings, not just the axes. */
const SPIKE_ROTATION_STEPS = 8


export class GridEditor {
    grid: Grid
    hoveredCell: Cell | null = null

    editorMode: EditorMode = "blocks"
    baseShape: BaseShape = "full"
    rotationIndex: number = 0
    /** Applied to newly painted hull cells and newly placed modules alike. */
    selectedColor: string = "#808080"

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
            this.placementRotationIndex = (this.placementRotationIndex + 1) % SPIKE_ROTATION_STEPS
            return
        }

        const variants = ROTATABLE[this.baseShape]
        if (variants) {
            this.rotationIndex = (this.rotationIndex + 1) % variants.length
        }
    }

    /** Spike heading, in 45-degree increments. */
    get spikeRotation(): number {
        return this.placementRotationIndex * ((Math.PI * 2) / SPIKE_ROTATION_STEPS)
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
        this.ghost.color = this.selectedColor
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
     * Whether the active tool can be applied at a cell.
     *
     * Spikes are the exception to "modules sit on hull": they mount like
     * blocks into empty cells touching the hull, which is what makes a spiked
     * ram possible. They still don't extend where hull can be built.
     */
    canApplyToolAt(cell: Cell): boolean {
        const { column, row } = cell.position

        if (this.selectedPlacementType === "spike") {
            return this.grid.canMountAt(column, row)
        }

        // Everything else needs hull, or an attachment already there to select
        // or erase.
        return cell.shape !== "empty" || this.grid.isAttachment(column, row)
    }

    /**
     * Applies the active module tool to a cell. With no tool selected a click
     * just selects whatever module is already there.
     */
    private applyPlacementTool(cell: Cell) {
        if (!this.canApplyToolAt(cell)) return

        const tool = this.selectedPlacementType

        if (tool === null) {
            this.selectedPlacement = cell.placement ?? null
            return
        }

        if (tool === "erase") {
            if (cell.placement) this.grid.setAttachment(cell, null)
            this.selectedPlacement = null
            return
        }

        const placement = PLACEMENT_FACTORIES[tool]()
        placement.cell = cell
        placement.color = this.selectedColor
        if (placement instanceof Spike) placement.rotation = this.spikeRotation

        // setAttachment routes to hull-backed placement when there is hull here.
        this.grid.setAttachment(cell, placement)
        this.selectedPlacement = placement
    }

    upgradeSelectedPlacement(): boolean {
        if (!this.selectedPlacement || this.selectedPlacement.level >= 5) return false
        this.selectedPlacement.level = (this.selectedPlacement.level + 1) as PlacementLevel
        return true
    }

    removeSelectedPlacement() {
        if (!this.selectedPlacement?.cell) return
        // setAttachment handles both hull-mounted modules and free-standing ones.
        this.grid.setAttachment(this.selectedPlacement.cell, null)
        this.selectedPlacement = null
    }
}
