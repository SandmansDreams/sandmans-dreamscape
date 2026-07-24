import { getDistance } from "./helpers"

export interface InputState {
    forward: boolean,
    left: boolean,
    backward: boolean,
    right: boolean,
    space: boolean,
}

const NEUTRAL_INPUT: InputState = { forward: false, left: false, backward: false, right: false, space: false }

export type TargetProvider = () => Vector2

export class Vector2 {
    constructor(
        public x = 0,
        public y = 0
    ) {}

    add(other: Vector2) {
        this.x += other.x
        this.y += other.y
        return this;
    }

    subtract(other: Vector2) {
        this.x -= other.x
        this.y -= other.y
        return this;
    }

    multiply(scalar: number) {
        this.x *= scalar
        this.y *= scalar
        return this;
    }

    clone() {
        return new Vector2(this.x, this.y)
    }

    normalize() {
        const length = this.getSpeed();

        if (length > 0) {
            this.x /= length;
            this.y /= length;
        }

        return this;
    }

    static fromAngle(angle: number) {
        return new Vector2(
            Math.cos(angle),
            Math.sin(angle)
        )
    }

    getSpeed() {
        return Math.hypot(this.x, this.y)
    }
}

export abstract class Entity { // A thing that has physics on the game plane
    position: Vector2 = new Vector2(0, 0)
    velocity: Vector2 = new Vector2(0, 0)
    drag: number = 0.9999
    rotation: number = 0
    rotationDrag: number = 0.9999
    rotationSpeed: number = 0
    hitbox?: Hitbox

    constructor(position: Vector2, velocity: Vector2, rotation = 0) {
        this.position = position
        this.velocity = velocity
        this.rotation = rotation
    }

    // Every entity (player, enemies, projectiles...) advances the same way:
    // just a timestep in. How it decides *what* to do is up to it.
    abstract update(delta: number): void

    abstract draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera,
        debugMode?: boolean
    ): void

    drawStats(ctx: CanvasRenderingContext2D, screenX: number, screenY: number) {
        const speed = this.velocity.getSpeed()
 
        // Direction as a compass-style degree reading, 0-360
        const directionDeg = ((this.rotation * 180 / Math.PI) % 360 + 360) % 360
 
        const lines = [
            `speed: ${speed.toFixed(2)}`,
            `rotation-speed: ${Math.round(this.rotationSpeed * 10000) / 100}`,
            `dir: ${directionDeg.toFixed(1)}°`,
            `pos: (${Math.round(this.position.x * 100) / 100}, ${Math.round(this.position.y * 100) / 100})`
        ]
 
        ctx.save()
 
        // Drawn unrotated and after ctx.restore() above, so the text
        // stays upright regardless of which way the ship is facing.
        ctx.font = "12px monospace"
        ctx.fillStyle = "rgba(0, 221, 255, 0.8)"
        ctx.textBaseline = "top"
 
        const offsetX = 50
        const lineHeight = 14
 
        lines.forEach((line, i) => {
            ctx.fillText(line, screenX + offsetX, screenY - lineHeight + i * lineHeight)
        })
 
        ctx.restore()
    }

    drawVelocityVector(
        ctx: CanvasRenderingContext2D,
        screenX: number,
        screenY: number
    ) {
        const speed = this.velocity.getSpeed()

        // Pixels per unit of velocity
        const scale = 5

        const endX = screenX + this.velocity.x * scale
        const endY = screenY + this.velocity.y * scale

        const angle = Math.atan2(this.velocity.y, this.velocity.x)
        const headLength = 8

        ctx.save()

        ctx.strokeStyle = "#00ff88"
        ctx.fillStyle = "#00ff88"
        ctx.lineWidth = 2

        // Shaft
        ctx.beginPath()
        ctx.moveTo(screenX, screenY)
        ctx.lineTo(endX, endY)
        ctx.stroke()

        // Arrowhead
        ctx.beginPath()
        ctx.moveTo(endX, endY)
        ctx.lineTo(
            endX - Math.cos(angle - Math.PI / 6) * headLength,
            endY - Math.sin(angle - Math.PI / 6) * headLength
        )
        ctx.lineTo(
            endX - Math.cos(angle + Math.PI / 6) * headLength,
            endY - Math.sin(angle + Math.PI / 6) * headLength
        )
        ctx.closePath()
        ctx.fill()

        ctx.restore()
    }

    drawRotationVelocity(
        ctx: CanvasRenderingContext2D
    ) {
        const speed = Math.abs(this.rotationSpeed);

        if (speed < 0.0001) {
            return;
        }

        const scale = 300;
        const length = speed * scale

        // Distance from center of ship
        const offset = 22;

        const clockwise = this.rotationSpeed > 0;

        // Arrow points in the direction of rotation
        const y1 = 0;
        const y2 = clockwise ? length : -length;

        ctx.save();

        ctx.strokeStyle = "#ff9900";
        ctx.fillStyle = "#ff9900";
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(offset, y1);
        ctx.lineTo(offset, y2);
        ctx.stroke();

        const head = 6;
        const angle = clockwise ? Math.PI / 2 : -Math.PI / 2;

        ctx.beginPath();
        ctx.moveTo(offset, y2);
        ctx.lineTo(
            offset - Math.cos(angle - Math.PI / 6) * head,
            y2 - Math.sin(angle - Math.PI / 6) * head
        );
        ctx.lineTo(
            offset - Math.cos(angle + Math.PI / 6) * head,
            y2 - Math.sin(angle + Math.PI / 6) * head
        );
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }
}

export abstract class Hitbox { // For collision with other entities
    constructor(
        public offset: Vector2 = new Vector2()
    ) {}

    abstract intersects(
        myPosition: Vector2,
        other: Hitbox,
        otherPosition: Vector2
    ): boolean;

    abstract draw(
        ctx: CanvasRenderingContext2D,
        position: Vector2,
        rotation: number,
        camera: Camera
    ): void;

    circleCircle(
        a: CircleHitbox,
        aPos: Vector2,
        b: CircleHitbox,
        bPos: Vector2
    ) {
        const dx = aPos.x - bPos.x;
        const dy = aPos.y - bPos.y;

        const radius =
            a.radius + b.radius;

        return dx * dx + dy * dy <= radius * radius;
    }
}

export abstract class Controller { // A thing that makes other things move
    input: InputState = { ...NEUTRAL_INPUT }

    protected clearInput() {
        Object.assign(this.input, NEUTRAL_INPUT)
    }

    abstract update(ship: Ship, delta: number): void
}

export class PlayerController extends Controller {
    constructor(
        private keyboard: InputState
    ) {
        super()
    }

    update(_ship: Ship, _delta: number) {
        Object.assign(this.input, this.keyboard)
    }
}

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

    draw(ctx: CanvasRenderingContext2D, camera: Camera, debugMode: boolean) {
        for (const ship of this.ships) {
            ship.draw(ctx, camera, debugMode)
        }
    }
}

export class FollowController extends Controller {
    constructor(
        public target: TargetProvider
    ) {
        super();
    }

    update(ship: Ship) {
        this.clearInput();

        const targetPos: Vector2 = this.target()

        const desiredDistance = 200
        const distance = getDistance(ship.position, targetPos);
        const relativeSpeed = targetPos.getSpeed()

        if (distance < desiredDistance && ship.velocity.getSpeed() < 1) {
            return
        }

        const arriveRadius = 250;
        const arriveAngle = Math.PI / 3; // 60°
        const maxSpeed = 8;

        const toTarget =
            targetPos
                .clone()
                .subtract(ship.position);

        if (distance < 10) {
            return;
        }

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

        const maxRotationSpeed = 0.02; 

        const desiredRotationSpeed =
            Math.sign(error) *
            maxRotationSpeed
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

        const velocityError =
            desiredVelocity
                .clone()
                .subtract(ship.velocity);

        if (velocityError.getSpeed() > 0.5) {
            this.input.space = true;
        }
    }

    paintTarget(
        ship: Ship,
        ctx: CanvasRenderingContext2D,
        camera: Camera,
    ) {
        const targetPos: Vector2 = this.target() 

        const relativeTargetX =
            targetPos.x
            - camera.position.x
            + ctx.canvas.clientWidth / 2;

        const relativeTargetY =
            targetPos.y
            - camera.position.y
            + ctx.canvas.clientHeight / 2;

        const relativeShipX = 
            ship.position.x
            - camera.position.x
            + ctx.canvas.clientWidth / 2;

        const relativeShipY = 
            ship.position.y
            - camera.position.y
            + ctx.canvas.clientHeight / 2;

        const size = 10;

        ctx.save();

        ctx.strokeStyle = "#ff4040";
        ctx.lineWidth = 2;

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(relativeTargetX - size, relativeTargetY);
        ctx.lineTo(relativeTargetX + size, relativeTargetY);
        ctx.moveTo(relativeTargetX, relativeTargetY - size);
        ctx.lineTo(relativeTargetX, relativeTargetY + size);
        ctx.stroke();

        // Circle
        ctx.beginPath();
        ctx.arc(relativeTargetX, relativeTargetY, size * 0.6, 0, Math.PI * 2);
        ctx.stroke();

                // Path
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(255, 64, 64, 0.2)";

        ctx.beginPath();
        ctx.moveTo(relativeShipX, relativeShipY);
        ctx.lineTo(relativeTargetX, relativeTargetY);
        ctx.stroke();

        ctx.restore();
    }
}

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
        debugMode: boolean
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

        if (debugMode) {
            this.drawRotationVelocity(ctx)
        }

        ctx.restore()

        if (debugMode) {
            this.drawStats(ctx, x, y)
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

export class CircleHitbox extends Hitbox {
    constructor(
        public radius: number,
        offset = new Vector2()
    ) {
        super(offset);
    }

    intersects(
        myPosition: Vector2,
        other: Hitbox,
        otherPosition: Vector2
    ) {
        if (other instanceof CircleHitbox) {
            return this.circleCircle(
                this,
                myPosition,
                other,
                otherPosition
            );
        }

        return false;
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.save();

        ctx.translate(this.offset.x, this.offset.y);

        ctx.strokeStyle = "lime";
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
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

        const t = Math.max(distance / this.maxDist, 1)

        const drift = this.drift * t

        this.position.x += dx * drift
        this.position.y += dy * drift
    }
}