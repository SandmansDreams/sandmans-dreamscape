import { Entity } from "./entity"
import { PhysicsObject, Vector2 } from "../physics"
import { Controller, FollowController } from "../controller"
import { BoxCollider } from "../physics"
import { NEUTRAL_INPUT } from "../controller"
import { Camera, NO_DEBUG, type DebugOptions } from "../types"
import { Grid } from "../grid"
import { CELL_SIZE } from "../helpers"
import { drawHealthBar } from "../hud"
import type { SurfaceLight } from "../lighting"
import { Particle } from "../particle"
import { Thruster, type PlacementContext, type Targetable } from "../placements"

/**
 * Ship grids are authored nose-up, but a rotation of 0 points along +X, so the
 * grid is drawn a quarter turn ahead of the hull's heading. Lighting has to
 * apply the same offset to land in grid space.
 */
export const GRID_ROTATION_OFFSET = Math.PI / 2

export class Ship extends Entity {
    rotationThrust: number
    grid: Grid

    private thrustRevision = -1
    private cachedThrust = 0

    /**
     * Commanded acceleration this frame: -1 reverse, 0 coasting, +1 forward.
     * Read by mounted modules — thrusters use it to drive their plume.
     */
    throttle: number = 0

    /** Reused each frame; see PlacementContext on why it must not be retained. */
    private readonly placementContext: PlacementContext = {
        worldPos: new Vector2(),
        shipRotation: 0,
        velocityX: 0,
        velocityY: 0,
        throttle: 0,
        targets: []
    }

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

    /**
     * Rotation that maps world space into this ship's grid space, for lighting.
     */
    get lightRotation(): number {
        return this.rotation + GRID_ROTATION_OFFSET
    }

    /** Radius used for projectile hit tests and view culling. */
    get hitRadius(): number {
        return this.grid.getBoundingRadius()
    }

    takeDamage(amount: number) {
        this.currentHealth -= amount
    }

    /**
     * Summed thrust of every mounted thruster.
     *
     * Read every frame from update(), so it is cached against the grid's
     * revision rather than rescanning the hull each tick.
     */
    get totalThrust(): number {
        if (this.thrustRevision !== this.grid.revision) {
            let thrust = 0
            for (const cell of this.grid.placedCells) {
                if (cell.placement instanceof Thruster) thrust += cell.placement.effectiveThrust
            }
            this.cachedThrust = thrust
            this.thrustRevision = this.grid.revision
        }
        return this.cachedThrust
    }

    /**
     * Rebuilds the hitbox from the current hull.
     *
     * A hull-tight oriented box rather than the grid's bounding circle: the
     * starter hull is roughly 2:1, so a circle around it left a lot of empty
     * space colliding with things.
     */
    updateCollider() {
        const { width, height } = this.grid.getFilledSize()

        const collider = new BoxCollider(width, height, new Vector2(), this)
        // The box is authored in grid space, which sits a quarter turn ahead
        // of the hull's heading.
        collider.angleOffset = GRID_ROTATION_OFFSET

        this.collider = collider
        this.mass = this.grid.filledCount || 10
    }

    cellToWorld(col: number, row: number): Vector2 {
        const center = this.grid.getCenter()
        const localX = col * CELL_SIZE + CELL_SIZE / 2 - center.x
        const localY = row * CELL_SIZE + CELL_SIZE / 2 - center.y

        const gridAngle = this.lightRotation
        const cos = Math.cos(gridAngle)
        const sin = Math.sin(gridAngle)

        return new Vector2(
            this.position.x + localX * cos - localY * sin,
            this.position.y + localX * sin + localY * cos
        )
    }

    updatePlacements(delta: number, targets: Targetable[]): Particle[] {
        const placed = this.grid.placedCells
        if (placed.length === 0) return EMPTY_PARTICLES

        // Hoisted out of the loop: these were recomputed per placement per
        // frame via cellToWorld.
        const center = this.grid.getCenter()
        const gridAngle = this.lightRotation
        const cos = Math.cos(gridAngle)
        const sin = Math.sin(gridAngle)

        const ctx = this.placementContext
        ctx.shipRotation = this.rotation
        ctx.velocityX = this.velocity.x
        ctx.velocityY = this.velocity.y
        ctx.throttle = this.throttle
        ctx.targets = targets

        const spawned: Particle[] = []

        for (const cell of placed) {
            const localX = cell.position.column * CELL_SIZE + CELL_SIZE / 2 - center.x
            const localY = cell.position.row * CELL_SIZE + CELL_SIZE / 2 - center.y

            ctx.worldPos.x = this.position.x + localX * cos - localY * sin
            ctx.worldPos.y = this.position.y + localX * sin + localY * cos

            const particles = cell.placement!.update(delta, ctx)
            for (let i = 0; i < particles.length; i++) spawned.push(particles[i])
        }

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

        // Forward and backward cancel when both are held.
        const thrust = this.totalThrust
        this.throttle = thrust > 0
            ? (input.forward ? 1 : 0) - (input.backward ? 1 : 0)
            : 0

        if (this.throttle !== 0) {
            const acceleration = (thrust / (this.mass / 10)) * delta * this.throttle
            this.velocity.x += Math.cos(this.rotation) * acceleration
            this.velocity.y += Math.sin(this.rotation) * acceleration
        }

        this.velocity.multiply(this.drag);

        this.position.x += this.velocity.x * delta
        this.position.y += this.velocity.y * delta
    }

    draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera,
        debug: DebugOptions = NO_DEBUG,
        light?: SurfaceLight
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
        ctx.rotate(GRID_ROTATION_OFFSET)
        const center = this.grid.getCenter()
        ctx.translate(-center.x, -center.y)
        this.grid.draw(ctx, 1, false, light)

        for (const cell of this.grid.placedCells) {
            const px = cell.position.column * CELL_SIZE
            const py = cell.position.row * CELL_SIZE
            cell.placement!.draw(ctx, px, py, CELL_SIZE)
            cell.placement!.drawDebug(ctx, px, py, CELL_SIZE, debug)
        }

        ctx.restore()
        ctx.restore()

        drawHealthBar(ctx, x, y, this.grid.getBoundingRadius(), camera.zoom, this.currentHealth, this.maxHealth)

        if (debug.stats) {
            this.drawStats(ctx, x, y)
        }

        if (debug.vectors) {
            this.drawVelocityVector(ctx, x, y)

            if (this.controller instanceof FollowController) {
                this.controller.paintTarget(this, ctx, camera)
            }
        }
    }

    onCollision(_other: PhysicsObject): void {

    }
}

/** Shared empty result so the common "no placements" path allocates nothing. */
const EMPTY_PARTICLES: Particle[] = []
