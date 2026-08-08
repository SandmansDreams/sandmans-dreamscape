import { FollowController, type PlayerController } from "./controller"
import type { Entity } from "./entities/entity"
import type { Ship } from "./entities/ship"
import type { SurfaceLight } from "./lighting"
import type { Particle } from "./particle"
import type { Targetable } from "./placements"
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
        // Assigned before setActiveShip so the activated ship gets the real
        // controller rather than undefined.
        this.controller = playerController
        this.setActiveShip(currentShipId ?? 0)
    }

    setActiveShip(shipId: number) {
        if (shipId < 0 || shipId >= this.ships.length || shipId === this.currentShipId) return

        const lead = this.ships[shipId]

        for (let s = 0; s < this.ships.length; s++) {
            if (s === shipId) continue
            this.ships[s].controller = new FollowController(() => lead.position)
        }

        lead.controller = this.controller
        this.currentShipId = shipId
    }

    get currentShip(): Ship {
        return this.ships[this.currentShipId]
    }

    update(delta: number, targets?: Targetable[]): Particle[] {
        const spawned: Particle[] = []
        for (const ship of this.ships) {
            ship.update(delta)
            if (targets) {
                const fired = ship.updatePlacements(delta, targets)
                for (let i = 0; i < fired.length; i++) spawned.push(fired[i])
            }
        }
        return spawned
    }

    draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera,
        debug: DebugOptions = NO_DEBUG,
        lights?: Map<Ship, SurfaceLight>
    ) {
        for (const ship of this.ships) {
            ship.draw(ctx, camera, debug, lights?.get(ship))
        }
    }
}

/** Reused by worldToScreen — see the note on that method. */
const screenScratch = new Vector2(0, 0)

export class Camera {
    position: Vector2 = new Vector2(0, 0)
    drift: number = 0.07
    maxDist: number = 150
    zoom: number = 1
    minZoom: number = 0.25
    maxZoom: number = 4

    /**
     * Applied by the renderer as a whole-canvas rotation, not by
     * worldToScreen. Only non-zero during the build/fly camera transition.
     */
    rotation: number = 0

    follow(target: Entity) {
        const dx = target.position.x - this.position.x
        const dy = target.position.y - this.position.y

        const distance = Math.hypot(dx, dy)
        const t = Math.min(distance / this.maxDist, 1)
        const drift = this.drift * t

        this.position.x += dx * drift
        this.position.y += dy * drift
    }

    /**
     * Returns a SHARED vector, valid only until the next call.
     *
     * This runs once per entity and once per particle per frame; returning a
     * fresh Vector2 each time made it one of the biggest sources of garbage in
     * the render loop. Every caller destructures immediately — keep it that
     * way, and use screenToWorld (which does allocate) if you need to hold on
     * to a result.
     */
    worldToScreen(worldX: number, worldY: number, canvasWidth: number, canvasHeight: number): Vector2 {
        screenScratch.x = (worldX - this.position.x) * this.zoom + canvasWidth / 2
        screenScratch.y = (worldY - this.position.y) * this.zoom + canvasHeight / 2
        return screenScratch
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
