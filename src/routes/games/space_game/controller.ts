import type { Entity } from "./entities/entity"
import type { Flock } from "./flock"
import { angleDelta, getDistance } from "./helpers"
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

    /** The target actually being steered toward: temporary overrides standing. */
    private currentTarget(): Vector2 | null {
        if (this.temporaryTarget) return this.temporaryTarget()
        return this.target ? this.target() : null
    }

    update(ship: Entity) {
        this.clearInput();

        const targetPos = this.currentTarget()
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

        const error = angleDelta(ship.rotation, desiredAngle);

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

        // Arriving at a temporary waypoint hands control back to the standing target.
        if (this.temporaryTarget && distance < desiredDistance) {
            this.target = this.priorTarget
            this.priorTarget = null
            this.temporaryTarget = null
        }
    }

    paintTarget(
        ship: Entity,
        ctx: CanvasRenderingContext2D,
        camera: Camera,
    ) {
        const targetPos = this.currentTarget()
        if (!targetPos) return

        const width = ctx.canvas.clientWidth
        const height = ctx.canvas.clientHeight

        // worldToScreen returns a shared vector, so copy out before the next call.
        const projected = camera.worldToScreen(targetPos.x, targetPos.y, width, height)
        const targetX = projected.x
        const targetY = projected.y

        const shipScreen = camera.worldToScreen(ship.position.x, ship.position.y, width, height)
        const shipX = shipScreen.x
        const shipY = shipScreen.y

        const size = 10;

        ctx.save();

        ctx.strokeStyle = "#ff4040";
        ctx.lineWidth = 2;

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(targetX - size, targetY);
        ctx.lineTo(targetX + size, targetY);
        ctx.moveTo(targetX, targetY - size);
        ctx.lineTo(targetX, targetY + size);
        ctx.stroke();

        // Circle
        ctx.beginPath();
        ctx.arc(targetX, targetY, size * 0.6, 0, Math.PI * 2);
        ctx.stroke();

        // Path
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(255, 64, 64, 0.2)";

        ctx.beginPath();
        ctx.moveTo(shipX, shipY);
        ctx.lineTo(targetX, targetY);
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

export interface BoidsWeights {
    separationRadius: number
    alignmentRadius: number
    cohesionRadius: number
    separationWeight: number
    alignmentWeight: number
    cohesionWeight: number
    attackWeight: number
    attackRange: number
    orbitRange: number
}

export const DEFAULT_BOIDS: BoidsWeights = {
    separationRadius: 80,
    alignmentRadius: 200,
    cohesionRadius: 250,
    separationWeight: 1.5,
    alignmentWeight: 0.8,
    cohesionWeight: 0.6,
    attackWeight: 1.0,
    attackRange: 250,
    orbitRange: 120
}

export class BoidsController extends Controller {
    private orbitDirection: number = Math.random() < 0.5 ? 1 : -1
    private strafeTimer: number = 0
    private strafeInterval: number = nextStrafeInterval()

    readonly weights: BoidsWeights

    constructor(
        public target: Entity,
        public flock: Flock,
        weights: Partial<BoidsWeights> = {}
    ) {
        super()
        this.weights = { ...DEFAULT_BOIDS, ...weights }
    }

    update(body: Entity, delta: number) {
        this.clearInput()
        this.strafeTimer += delta

        const w = this.weights

        let sepX = 0, sepY = 0
        let alignX = 0, alignY = 0
        let cohX = 0, cohY = 0
        let sepCount = 0, alignCount = 0, cohCount = 0

        // Only entities within the widest steering radius can matter, so this
        // asks the flock's spatial hash instead of walking every member.
        const neighbors = this.flock.neighbors(
            body.position.x,
            body.position.y,
            Math.max(w.separationRadius, w.alignmentRadius, w.cohesionRadius)
        )

        for (let i = 0; i < neighbors.length; i++) {
            const other = neighbors[i]
            if (other === body || other.currentHealth <= 0) continue

            const dx = other.position.x - body.position.x
            const dy = other.position.y - body.position.y
            const dist = Math.hypot(dx, dy)
            if (dist === 0) continue

            if (dist < w.separationRadius) {
                sepX -= dx / dist
                sepY -= dy / dist
                sepCount++
            }
            if (dist < w.alignmentRadius) {
                alignX += other.velocity.x
                alignY += other.velocity.y
                alignCount++
            }
            if (dist < w.cohesionRadius) {
                cohX += other.position.x
                cohY += other.position.y
                cohCount++
            }
        }

        let steerX = 0, steerY = 0

        if (sepCount > 0) {
            steerX += (sepX / sepCount) * w.separationWeight
            steerY += (sepY / sepCount) * w.separationWeight
        }
        if (alignCount > 0) {
            steerX += (alignX / alignCount - body.velocity.x) * w.alignmentWeight * 0.01
            steerY += (alignY / alignCount - body.velocity.y) * w.alignmentWeight * 0.01
        }
        if (cohCount > 0) {
            steerX += (cohX / cohCount - body.position.x) * w.cohesionWeight * 0.001
            steerY += (cohY / cohCount - body.position.y) * w.cohesionWeight * 0.001
        }

        const toX = this.target.position.x - body.position.x
        const toY = this.target.position.y - body.position.y
        const distance = Math.hypot(toX, toY)

        if (distance > 0) {
            if (distance > w.attackRange) {
                steerX += (toX / distance) * w.attackWeight
                steerY += (toY / distance) * w.attackWeight
            } else {
                const orbitAngle = Math.atan2(toY, toX) + (Math.PI / 2) * this.orbitDirection
                steerX += Math.cos(orbitAngle) * w.attackWeight * 0.5
                steerY += Math.sin(orbitAngle) * w.attackWeight * 0.5

                // Too close: back off along the approach vector.
                if (distance < w.orbitRange) {
                    steerX -= (toX / distance) * 0.3
                    steerY -= (toY / distance) * 0.3
                }
            }
        }

        const angleError = angleDelta(body.rotation, Math.atan2(steerY, steerX))

        if (angleError > 0.05) this.input.right = true
        else if (angleError < -0.05) this.input.left = true

        if (Math.abs(angleError) < 0.5) this.input.forward = true

        // The threshold is drawn once and held, so the interval is actually
        // random per swap rather than re-rolled (and effectively shortened)
        // every single frame.
        if (this.strafeTimer > this.strafeInterval) {
            this.orbitDirection *= -1
            this.strafeTimer = 0
            this.strafeInterval = nextStrafeInterval()
        }
    }
}

function nextStrafeInterval(): number {
    return 200 + Math.random() * 150
}