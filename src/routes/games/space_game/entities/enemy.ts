import { Ship } from "./ship"
import { Grid, type BlockShape } from "../grid"
import { BoidsController } from "../controller"
import { Vector2 } from "../physics"
import type { Entity } from "./entity"
import { Thruster } from "../placements"
import ScouerData from "./shipModels/Scouter.json"

export function spawnScouter(position: Vector2, target: Entity, flock: Ship[]): Ship {
    const grid = new Grid()
    const data = {
        ...ScouerData,
        cells: ScouerData.cells.map(c => ({ ...c, s: c.s as BlockShape }))
    }
    grid.loadFrom(data)

    const bounds = grid.getFilledBounds()
    if (bounds) {
        const midCol = Math.floor((bounds.minCol + bounds.maxCol) / 2)
        const thrusterCell = grid.getCell(midCol, bounds.maxRow)
        const thruster = new Thruster()
        thruster.thrustPower = 0.15
        thruster.cell = thrusterCell
        grid.setCell(thrusterCell, thrusterCell.shape, thrusterCell.color, thruster)
    }

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
