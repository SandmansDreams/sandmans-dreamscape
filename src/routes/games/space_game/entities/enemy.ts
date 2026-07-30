import { Ship } from "./ship"
import { Grid, type BlockShape } from "../grid"
import { AttackController } from "../controller"
import { Vector2 } from "../physics"
import type { Entity } from "./entity"
import ScouerData from "./shipModels/Scouter.json"

export function spawnScouter(position: Vector2, target: Entity): Ship {
    const grid = new Grid()
    const data = {
        ...ScouerData,
        cells: ScouerData.cells.map(c => ({ ...c, s: c.s as BlockShape }))
    }
    grid.loadFrom(data)

    const ship = new Ship(
        position,
        new Vector2(0, 0),
        0,
        new AttackController(target),
        grid
    )

    ship.currentHealth = 30
    ship.maxHealth = 30
    ship.thrust = 0.15
    ship.rotationThrust = 0.002

    return ship
}
