import { FollowController, type PlayerController } from "./controller"
import type { Entity } from "./entities/entity"
import type { Ship } from "./entities/ship"
import { Vector2 } from "./physics"

export type DebugOptions = {
    stats: boolean
    vectors: boolean
    hitboxes: boolean
}

export const NO_DEBUG: DebugOptions = { stats: false, vectors: false, hitboxes: false }


export class Player {
    controller: PlayerController
    ships: Ship[]
    currentShipId: number = -1

    constructor(
        ships: Ship[],
        playerController: PlayerController,
        currentShipId?: number,
    ) {
        this.ships = ships
        this.setActiveShip(currentShipId ?? 0)
        this.controller = playerController

        this.currentShip.controller = this.controller
    }

    setActiveShip(shipId: number) {
        if (shipId < 0 || shipId >= this.ships.length || shipId === this.currentShipId) return

        for (let s = 0; s < this.ships.length; s++) {
            this.ships[s].controller = new FollowController(() => this.ships[shipId].position)
            this.ships[s].color = "grey"
        }

        this.ships[shipId].controller = this.controller
        this.ships[shipId].color = "red"

        this.currentShipId = shipId
    }

    get currentShip(): Ship {
        return this.ships[this.currentShipId]
    }

    update(delta: number) {
        for (const ship of this.ships) {
            ship.update(delta)
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: Camera, debug: DebugOptions = NO_DEBUG) {
        for (const ship of this.ships) {
            ship.draw(ctx, camera, debug)
        }
    }
}

export class Camera {
    position: Vector2 = new Vector2(0, 0)
    drift: number = 0.07
    maxDist: number = 150

    follow(target: Entity) {
        const dx = target.position.x - this.position.x
        const dy = target.position.y - this.position.y

        const distance = Math.hypot(dx, dy)

        // Clamp so drift ramps up smoothly as the target pulls away, capping
        // at 1 once it's past maxDist (this was Math.max before, which made
        // the multiplier >= 1 unconditionally and defeated the point of the
        // "drift" easing).
        const t = Math.min(distance / this.maxDist, 1)

        const drift = this.drift * t

        this.position.x += dx * drift
        this.position.y += dy * drift
    }
}