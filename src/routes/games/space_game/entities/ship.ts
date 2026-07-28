import { Entity } from "./entity"
import { Vector2 } from "../physics"
import { Controller, FollowController } from "../controller"
import { CircleCollider } from "../physics"
import { NEUTRAL_INPUT } from "../controller"
import { Camera, NO_DEBUG, type DebugOptions } from "../types"

export class Ship extends Entity {
    controller?: Controller
    thrust: number
    rotationThrust: number
    color: string = "grey"

    constructor(
        position: Vector2,
        velocity: Vector2,
        rotation: number,
        // blocks: Block[]
        // placements: Placement[]
    ) {
        super(position, velocity, rotation)
        this.thrust = 0.1
        this.rotationThrust = 0.001
        this.collider = new CircleCollider(15, new Vector2, this)
        this.mass = 10
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
        const x =
            this.position.x
            - camera.position.x
            + ctx.canvas.clientWidth / 2

        const y =
            this.position.y
            - camera.position.y
            + ctx.canvas.clientHeight / 2

        ctx.save()

        ctx.translate(x, y)
        ctx.rotate(this.rotation)

        ctx.beginPath()
        ctx.moveTo(18, 0)
        ctx.lineTo(-12, -10)
        ctx.lineTo(-6, 0)
        ctx.lineTo(-12, 10)
        ctx.closePath()

        ctx.fillStyle = this.color
        ctx.fill()

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
}