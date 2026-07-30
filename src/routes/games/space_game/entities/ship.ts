import { Entity } from "./entity"
import { PhysicsObject, Vector2 } from "../physics"
import { Controller, FollowController } from "../controller"
import { CircleCollider } from "../physics"
import { NEUTRAL_INPUT } from "../controller"
import { Camera, NO_DEBUG, type DebugOptions } from "../types"
import { Grid } from "../grid"
import { CELL_SIZE } from "../helpers"
import type { GridLightInfo } from "../lighting"
import { Particle } from "../particle"
import { Thruster, type Targetable } from "../placements"

export class Ship extends Entity {
    rotationThrust: number
    color: string = "grey"
    grid: Grid

    constructor(
        position: Vector2,
        velocity: Vector2,
        rotation: number,
        controller: Controller,
        grid: Grid
    ) {
        super(position, velocity, rotation, controller)
        this.grid = grid
        this.rotationThrust = 0.001
        this.updateCollider()
    }

    get totalThrust(): number {
        let thrust = 0
        this.grid.forEachFilled((cell) => {
            if (cell.placement instanceof Thruster) {
                thrust += cell.placement.effectiveThrust
            }
        })
        return thrust
    }

    get hasThrusters(): boolean {
        let found = false
        this.grid.forEachFilled((cell) => {
            if (cell.placement instanceof Thruster) found = true
        })
        return found
    }

    updateCollider() {
        const radius = this.grid.getBoundingRadius()
        this.collider = new CircleCollider(radius, new Vector2(), this)
        this.mass = this.grid.filledCount || 10
    }

    cellToWorld(col: number, row: number): Vector2 {
        const center = this.grid.getCenter()
        const localX = col * CELL_SIZE + CELL_SIZE / 2 - center.x
        const localY = row * CELL_SIZE + CELL_SIZE / 2 - center.y

        const gridAngle = this.rotation + Math.PI / 2
        const cos = Math.cos(gridAngle)
        const sin = Math.sin(gridAngle)

        return new Vector2(
            this.position.x + localX * cos - localY * sin,
            this.position.y + localX * sin + localY * cos
        )
    }

    updatePlacements(delta: number, targets: Targetable[]): Particle[] {
        const spawned: Particle[] = []

        this.grid.forEachFilled((cell) => {
            if (!cell.placement) return
            const worldPos = this.cellToWorld(cell.position.column, cell.position.row)
            const particles = cell.placement.update(delta, worldPos, this.rotation, targets)
            spawned.push(...particles)
        })

        return spawned
    }

    update(delta: number) {
        this.controller?.update(this, delta);

        const input =
            this.controller?.input ??
            NEUTRAL_INPUT;

        if (input.left) {
            this.rotationSpeed -=
                this.rotationThrust * delta;
        }

        if (input.right) {
            this.rotationSpeed +=
                this.rotationThrust * delta;
        }

        if (input.space) {
            this.velocity.multiply(0.99)
            this.rotationSpeed = this.rotationSpeed * (0.99)
        }

        this.rotationSpeed *= this.rotationDrag;
        this.rotation += this.rotationSpeed * delta;

        const thrust = this.totalThrust
        if (thrust > 0) {
            if (input.forward) {
                this.velocity.add(
                    Vector2
                        .fromAngle(this.rotation)
                        .multiply((thrust / (this.mass / 10)) * delta)
                );
            }

            if (input.backward) {
                this.velocity.add(
                    Vector2
                        .fromAngle(this.rotation + Math.PI)
                        .multiply((thrust / (this.mass / 10)) * delta)
                );
            }
        }

        this.velocity.multiply(this.drag);

        this.position.add(
            this.velocity
                .clone()
                .multiply(delta)
        );
    }

    draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera,
        debug: DebugOptions = NO_DEBUG,
        lightInfo?: GridLightInfo
    ) {
        const {x, y} = camera.worldToScreen(this.position.x, this.position.y, ctx.canvas.clientWidth, ctx.canvas.clientHeight)

        ctx.save()

        ctx.translate(x, y)
        ctx.rotate(this.rotation)
        ctx.scale(camera.zoom, camera.zoom)

        if (debug.vectors) {
            this.drawRotationVelocity(ctx)
        }

        if (debug.hitboxes) {
            this.collider?.drawDebug(ctx)
        }

        ctx.save()
        ctx.rotate(Math.PI / 2)
        const center = this.grid.getCenter()
        ctx.translate(-center.x, -center.y)
        this.grid.draw(ctx, 1, false, lightInfo)

        this.grid.forEachFilled((cell) => {
            if (!cell.placement) return
            const px = cell.position.column * CELL_SIZE
            const py = cell.position.row * CELL_SIZE
            cell.placement.draw(ctx, px, py, CELL_SIZE)
            cell.placement.drawDebug(ctx, px, py, CELL_SIZE, debug)
        })

        ctx.restore()

        ctx.restore()

        if (this.currentHealth < this.maxHealth) {
            const radius = this.grid.getBoundingRadius()
            const barWidth = radius * 2 * camera.zoom * 0.8
            const barHeight = 3
            const yOffset = -radius * camera.zoom - 8

            const bx = x - barWidth / 2
            const by = y + yOffset
            const healthPct = Math.max(0, this.currentHealth / this.maxHealth)

            ctx.fillStyle = "rgba(0, 0, 0, 0.5)"
            ctx.fillRect(bx, by, barWidth, barHeight)

            const r = Math.round(255 * (1 - healthPct))
            const g = Math.round(255 * healthPct)
            ctx.fillStyle = `rgb(${r}, ${g}, 50)`
            ctx.fillRect(bx, by, barWidth * healthPct, barHeight)
        }

        if (debug.stats) {
            this.drawStats(ctx, x, y)
        }

        if (debug.vectors) {
            this.drawVelocityVector(ctx, x, y)

            if (this.controller instanceof FollowController) {
                this.controller?.paintTarget(this, ctx, camera)
            }
        }
    }

    setColor(string: string) {
        this.color = string
    }

    onCollision(other: PhysicsObject): void {

    }
}
