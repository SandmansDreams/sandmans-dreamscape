import { FollowController, type PlayerController } from "./controller"
import type { Entity } from "./entities/entity"
import type { Ship } from "./entities/ship"
import type { GridLightInfo } from "./lighting"
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

    draw(ctx: CanvasRenderingContext2D, camera: Camera, debug: DebugOptions = NO_DEBUG, lightInfos?: Map<Ship, GridLightInfo>) {
        for (const ship of this.ships) {
            ship.draw(ctx, camera, debug, lightInfos?.get(ship))
        }
    }
}

export class Camera {
    position: Vector2 = new Vector2(0, 0)
    drift: number = 0.07
    maxDist: number = 150
    zoom: number = 1
    minZoom: number = 0.25
    maxZoom: number = 4

    follow(target: Entity) {
        const dx = target.position.x - this.position.x
        const dy = target.position.y - this.position.y

        const distance = Math.hypot(dx, dy)
        const t = Math.min(distance / this.maxDist, 1)
        const drift = this.drift * t

        this.position.x += dx * drift
        this.position.y += dy * drift
    }

    worldToScreen(worldX: number, worldY: number, canvasWidth: number, canvasHeight: number): Vector2 {
        return new Vector2(
            (worldX - this.position.x) * this.zoom + canvasWidth / 2,
            (worldY - this.position.y) * this.zoom + canvasHeight / 2
        )
    }

    // Inverse of worldToScreen - for turning a click into a world position.
    screenToWorld(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): Vector2 {
        return new Vector2(
            (screenX - canvasWidth / 2) / this.zoom + this.position.x,
            (screenY - canvasHeight / 2) / this.zoom + this.position.y
        )
    }

    zoomToward(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number, factor: number) {
        const worldBefore = this.screenToWorld(screenX, screenY, canvasWidth, canvasHeight)

        this.zoom = Math.min(Math.max(this.zoom * factor, this.minZoom), this.maxZoom)

        const worldAfter = this.screenToWorld(screenX, screenY, canvasWidth, canvasHeight)

        this.position.x += worldBefore.x - worldAfter.x
        this.position.y += worldBefore.y - worldAfter.y
    }
}