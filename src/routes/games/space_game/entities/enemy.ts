import { Ship } from "./ship"
import { Grid } from "../grid"
import type { BlockShape } from "../shapes"
import { BoidsController } from "../controller"
import type { Flock } from "../flock"
import { Vector2 } from "../physics"
import type { Entity } from "./entity"
import { Thruster } from "../placements"
import ScouterData from "./shipModels/Scouter1.json"

const SCOUTER_THRUST = 0.15

export function spawnScouter(position: Vector2, target: Entity, flock: Flock<Ship>): Ship {
    const grid = new Grid()
    grid.loadFrom({
        cells: ScouterData.cells.map(c => ({ ...c, s: c.s as BlockShape }))
    })

    mountRearThruster(grid)

    const ship = new Ship(
        position,
        new Vector2(0, 0),
        0,
        new BoidsController(target, flock),
        grid
    )

    ship.currentHealth = 30
    ship.maxHealth = 30
    ship.rotationThrust = 0.002
    ship.drag = 0.985
    ship.rotationDrag = 0.98

    return ship
}

/**
 * Bolts a thruster onto the hull's rear-centre cell.
 *
 * Walks outward from the middle of the last row to find a filled cell:
 * `setCell` deletes any cell whose shape is "empty", so mounting onto a gap
 * would silently drop the thruster and leave the scouter with no thrust at all.
 */
function mountRearThruster(grid: Grid) {
    const bounds = grid.getFilledBounds()
    if (!bounds) return

    const midCol = Math.floor((bounds.minCol + bounds.maxCol) / 2)
    const span = bounds.maxCol - bounds.minCol

    for (let offset = 0; offset <= span; offset++) {
        for (const col of offset === 0 ? [midCol] : [midCol - offset, midCol + offset]) {
            if (col < bounds.minCol || col > bounds.maxCol) continue
            if (!grid.isFilled(col, bounds.maxRow)) continue

            const cell = grid.getCell(col, bounds.maxRow)
            const thruster = new Thruster()
            thruster.thrustPower = SCOUTER_THRUST
            thruster.cell = cell
            grid.setCell(cell, cell.shape, cell.color, thruster)
            return
        }
    }
}
