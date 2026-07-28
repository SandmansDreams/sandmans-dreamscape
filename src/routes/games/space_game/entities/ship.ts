import { Entity } from "./entity"
import { PhysicsObject, Vector2 } from "../physics"
import { Controller, FollowController } from "../controller"
import { CircleCollider } from "../physics"
import { NEUTRAL_INPUT } from "../controller"
import { Camera, NO_DEBUG, type DebugOptions } from "../types"
import { ShipGrid } from "../builder"

export class Ship extends Entity {
    thrust: number
    rotationThrust: number
    color: string = "grey"
    grid: ShipGrid

    constructor(
        position: Vector2,
        velocity: Vector2,
        rotation: number,
        controller: Controller,
        grid: ShipGrid
    ) {
        super(position, velocity, rotation, controller)
        this.grid = grid
        this.thrust = 0.1
        this.rotationThrust = 0.001
        this.collider = new CircleCollider(15, new Vector2, this)
        this.mass = this.grid.filledCount || 10
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

        if (input.forward) {
            this.velocity.add(
                Vector2
                    .fromAngle(this.rotation)
                    .multiply(this.thrust * delta)
            );
        }

        if (input.backward) {
            this.velocity.add(
                Vector2
                    .fromAngle(this.rotation + Math.PI)
                    .multiply(this.thrust * delta)
            );
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
        debug: DebugOptions = NO_DEBUG
    ) {
        const {x, y} = camera.worldToScreen(this.position.x, this.position.y, ctx.canvas.clientWidth, ctx.canvas.clientHeight)

        ctx.save()

        ctx.translate(x, y)
        ctx.rotate(this.rotation)
        ctx.scale(camera.zoom, camera.zoom)
        
        this.grid.draw(ctx, 1)

        if (debug.vectors) {
            this.drawRotationVelocity(ctx)
        }

        if (debug.hitboxes) {
            this.collider?.drawDebug(ctx)
        }

        ctx.restore()

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