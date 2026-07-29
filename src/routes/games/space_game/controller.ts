import type { Entity } from "./entities/entity"
import { getDistance } from "./helpers"
import type { Vector2 } from "./physics"
import type { Camera } from "./types"

export interface InputState {
    forward: boolean,
    left: boolean,
    backward: boolean,
    right: boolean,
    space: boolean,
}

export const NEUTRAL_INPUT: InputState = { forward: false, left: false, backward: false, right: false, space: false }

export type TargetProvider = () => Vector2

export abstract class Controller { // A thing that makes other things move
    input: InputState = { ...NEUTRAL_INPUT }

    protected clearInput() {
        Object.assign(this.input, NEUTRAL_INPUT)
    }

    abstract update(entity: Entity, delta: number): void
}

export class EmptyController extends Controller{
    constructor() {
        super()
    }

    update(): void {
        return
    }
}

export class PlayerController extends Controller {
    constructor(
        private keyboard: InputState
    ) {
        super()
    }

    update(_ship: Entity, _delta: number) {
        Object.assign(this.input, this.keyboard)
    }
}

export class FollowController extends Controller {
    priorTarget: TargetProvider | null = null
    temporaryTarget: TargetProvider | null = null
    target: TargetProvider | null

    constructor(
        target: TargetProvider | null
    ) {
        super();
        this.target = target
    }

    update(ship: Entity) {
        this.clearInput();

        let targetPos: Vector2 | null = null

        if (this.temporaryTarget) {
            targetPos = this.temporaryTarget()
        } else {
            if (this.target) targetPos = this.target()
        }

        if (!targetPos) return

        const desiredDistance = 250
        const distance = getDistance(ship.position, targetPos);

        if (distance < desiredDistance && ship.velocity.getSpeed() < 1) {
            return
        }

        const arriveRadius = 250;
        const arriveAngle = Math.PI / 3; // 60°
        const maxSpeed = 800;

        const toTarget =
            targetPos
                .clone()
                .subtract(ship.position);

        const desiredSpeed =
            distance > arriveRadius
                ? maxSpeed
                : maxSpeed * distance / arriveRadius;

        const desiredVelocity =
            toTarget
                .normalize()
                .multiply(desiredSpeed);

        const steering =
            desiredVelocity
                .clone()
                .subtract(ship.velocity);

        if (steering.getSpeed() < 0.01) {
            return;
        }

        const desiredAngle =
            Math.atan2(
                steering.y,
                steering.x
            );

        let error =
            desiredAngle - ship.rotation;

        error = Math.atan2(
            Math.sin(error),
            Math.cos(error)
        );

        const maxRotationSpeed = 0.1;

        // Scale rotation speed down as we get closer to facing the target,
        // so the ship eases into alignment instead of overshooting.
        const desiredRotationSpeed =
            Math.sign(error) *
            maxRotationSpeed *
            Math.min(Math.abs(error) / arriveAngle, 1);

        const angularSteering =
            desiredRotationSpeed - ship.rotationSpeed;

        const deadZone = 0.001;

        if (angularSteering > deadZone) {
            this.input.right = true;
        } else if (angularSteering < -deadZone) {
            this.input.left = true;
        }

        const facingTolerance = 0.15;

        if (
            Math.abs(error) < facingTolerance &&
            ship.velocity.getSpeed() < desiredSpeed
        ) {
            this.input.forward = true;
        }

        if (distance < arriveRadius && ship.velocity.getSpeed() > distance * 0.02) {
            this.input.space = true;
        }

        if (this.temporaryTarget) {
            if (distance < desiredDistance) {
                this.target = this.priorTarget
                
                this.priorTarget = null
                this.temporaryTarget = null
            }
        }

        if (distance < desiredDistance) {
            return;
        }
    }

    paintTarget(
        ship: Entity,
        ctx: CanvasRenderingContext2D,
        camera: Camera,
    ) {
        let targetPos: Vector2 | null = null

        if (this.temporaryTarget) {
            targetPos = this.temporaryTarget()
        } else {
            if (this.target) targetPos = this.target()
        }

        if (!targetPos) return

        const relativeTarget = camera.worldToScreen(
            targetPos.x, targetPos.y,
            ctx.canvas.clientWidth, ctx.canvas.clientHeight
        )

        const relativeShip = camera.worldToScreen(
            ship.position.x, ship.position.y,
            ctx.canvas.clientWidth, ctx.canvas.clientHeight
        )

        const size = 10;

        ctx.save();

        ctx.strokeStyle = "#ff4040";
        ctx.lineWidth = 2;

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(relativeTarget.x - size, relativeTarget.y);
        ctx.lineTo(relativeTarget.x + size, relativeTarget.y);
        ctx.moveTo(relativeTarget.x, relativeTarget.y - size);
        ctx.lineTo(relativeTarget.x, relativeTarget.y + size);
        ctx.stroke();

        // Circle
        ctx.beginPath();
        ctx.arc(relativeTarget.x, relativeTarget.y, size * 0.6, 0, Math.PI * 2);
        ctx.stroke();

        // Path
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(255, 64, 64, 0.2)";

        ctx.beginPath();
        ctx.moveTo(relativeShip.x, relativeShip.y);
        ctx.lineTo(relativeTarget.x, relativeTarget.y);
        ctx.stroke();

        ctx.restore();
    }

    setTarget(newTarget: TargetProvider) {
        this.target = newTarget
    }

    setTemporaryTarget(newTarget: TargetProvider) {
        this.priorTarget = this.target
        this.temporaryTarget = newTarget
    }
}

export class AttackController extends Controller {
    constructor(
        public target: Entity
    ) {
        super();
    }

    update(
        body: Entity,
        delta: number
    ) {
        this.clearInput();

        const toTarget =
            this.target.position
                .clone()
                .subtract(body.position);

        const distance = toTarget.getSpeed();

        const desiredAngle = Math.atan2(
            toTarget.y,
            toTarget.x
        );

        let angleError =
            desiredAngle - body.rotation;

        angleError = Math.atan2(
            Math.sin(angleError),
            Math.cos(angleError)
        );

        // Rotate toward the target
        if (angleError > 0.05) {
            this.input.right = true;
        } else if (angleError < -0.05) {
            this.input.left = true;
        }

        const attackRange = 250;

        // Close distance
        if (
            distance > attackRange &&
            Math.abs(angleError) < 0.25
        ) {
            this.input.forward = true;
        }

        // Slow down when close
        if (
            distance < attackRange * 0.75 &&
            body.velocity.getSpeed() > 1
        ) {
            this.input.space = true;
        }

        // TODO:
        // if (distance < attackRange &&
        //     Math.abs(angleError) < 0.1)
        // {
        //     ship.firePrimaryWeapon();
        // }
    }
}