import { getDistance } from "./helpers"

// ---------------------------------------------------------------------------
// Collision math
//
// Every shape-pair test below returns a `Manifold` (or null if the shapes
// aren't overlapping). A manifold carries everything the physics step needs:
//   - normal: unit vector pointing from collider A toward collider B
//   - penetration: how far the shapes are overlapping along that normal
//
// `computeManifold` is the single entry point — it dispatches to the right
// test based on the concrete collider types. `Collider.intersects` and
// `CollisionManager` both build on top of this, so the actual math only
// lives in one place instead of being duplicated (and getting out of sync,
// which is what happened before — CollisionManager assumed every collider
// had a `.radius`, which broke as soon as a BoxCollider showed up).
// ---------------------------------------------------------------------------

export type Manifold = {
    normal: Vector2
    penetration: number
}

function manifoldCircleCircle(
    a: CircleCollider,
    b: CircleCollider
): Manifold | null {

    const ax = a.owner.position.x + a.offset.x;
    const ay = a.owner.position.y + a.offset.y;

    const bx = b.owner.position.x + b.offset.x;
    const by = b.owner.position.y + b.offset.y;

    const dx = bx - ax;
    const dy = by - ay;

    const distance = Math.hypot(dx, dy);
    const radiusSum = a.radius + b.radius;

    if (distance >= radiusSum) {
        return null;
    }

    // Centers exactly overlapping: pick an arbitrary normal rather than
    // dividing by zero.
    const normal = distance > 0
        ? new Vector2(dx / distance, dy / distance)
        : new Vector2(1, 0);

    return { normal, penetration: radiusSum - distance };
}

function manifoldBoxBox(
    a: BoxCollider,
    b: BoxCollider
): Manifold | null {

    const ax = a.owner.position.x + a.offset.x;
    const ay = a.owner.position.y + a.offset.y;

    const bx = b.owner.position.x + b.offset.x;
    const by = b.owner.position.y + b.offset.y;

    const dx = bx - ax;
    const dy = by - ay;

    const overlapX = (a.width + b.width) / 2 - Math.abs(dx);
    const overlapY = (a.height + b.height) / 2 - Math.abs(dy);

    if (overlapX <= 0 || overlapY <= 0) {
        return null;
    }

    // Resolve along whichever axis has the shallower overlap — the usual
    // AABB-vs-AABB "minimum translation vector" approach.
    if (overlapX < overlapY) {
        return {
            normal: new Vector2(dx < 0 ? -1 : 1, 0),
            penetration: overlapX
        };
    }

    return {
        normal: new Vector2(0, dy < 0 ? -1 : 1),
        penetration: overlapY
    };
}

// Normal points from the box toward the circle (i.e. box -> circle).
// computeManifold flips this as needed depending on argument order.
function manifoldCircleBox(
    circle: CircleCollider,
    box: BoxCollider
): Manifold | null {

    const cx = circle.owner.position.x + circle.offset.x;
    const cy = circle.owner.position.y + circle.offset.y;

    const bx = box.owner.position.x + box.offset.x;
    const by = box.owner.position.y + box.offset.y;

    const left = bx - box.width / 2;
    const right = bx + box.width / 2;
    const top = by - box.height / 2;
    const bottom = by + box.height / 2;

    const closestX = Math.max(left, Math.min(cx, right));
    const closestY = Math.max(top, Math.min(cy, bottom));

    const dx = cx - closestX;
    const dy = cy - closestY;
    const distanceSq = dx * dx + dy * dy;

    if (distanceSq > circle.radius * circle.radius) {
        return null;
    }

    // Circle's center is inside the box: dx/dy are both 0 (closest point IS
    // the center), so there's no direction to push along. Fall back to
    // pushing out toward whichever edge is nearest.
    if (distanceSq === 0) {
        const overlapLeft = cx - left;
        const overlapRight = right - cx;
        const overlapTop = cy - top;
        const overlapBottom = bottom - cy;

        const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

        if (minOverlap === overlapLeft) return { normal: new Vector2(-1, 0), penetration: overlapLeft + circle.radius };
        if (minOverlap === overlapRight) return { normal: new Vector2(1, 0), penetration: overlapRight + circle.radius };
        if (minOverlap === overlapTop) return { normal: new Vector2(0, -1), penetration: overlapTop + circle.radius };
        return { normal: new Vector2(0, 1), penetration: overlapBottom + circle.radius };
    }

    const distance = Math.sqrt(distanceSq);

    return {
        normal: new Vector2(dx / distance, dy / distance),
        penetration: circle.radius - distance
    };
}

export function computeManifold(a: Collider, b: Collider): Manifold | null {
    if (a instanceof CircleCollider && b instanceof CircleCollider) {
        return manifoldCircleCircle(a, b);
    }

    if (a instanceof BoxCollider && b instanceof BoxCollider) {
        return manifoldBoxBox(a, b);
    }

    if (a instanceof CircleCollider && b instanceof BoxCollider) {
        const m = manifoldCircleBox(a, b);
        // manifoldCircleBox always returns box -> circle (i.e. b -> a here).
        // Flip it so the result is consistently a -> b.
        return m && { normal: m.normal.clone().multiply(-1), penetration: m.penetration };
    }

    if (a instanceof BoxCollider && b instanceof CircleCollider) {
        // Already box -> circle, i.e. a -> b. No flip needed.
        return manifoldCircleBox(b, a);
    }

    return null;
}

// Boolean wrappers kept around in case other modules import these directly.
export function circleCircle(a: CircleCollider, b: CircleCollider): boolean {
    return manifoldCircleCircle(a, b) !== null;
}

export function boxBox(a: BoxCollider, b: BoxCollider): boolean {
    return manifoldBoxBox(a, b) !== null;
}

export function circleBox(circle: CircleCollider, box: BoxCollider): boolean {
    return manifoldCircleBox(circle, box) !== null;
}

export interface InputState {
    forward: boolean,
    left: boolean,
    backward: boolean,
    right: boolean,
    space: boolean,
}

const NEUTRAL_INPUT: InputState = { forward: false, left: false, backward: false, right: false, space: false }

export type TargetProvider = () => Vector2

// Independent debug overlays - each can be toggled without the others.
//   stats:    the text readout (speed, rotation, position, etc.)
//   vectors:  velocity/rotation arrows and steering-target guides
//   hitboxes: collider outlines
export type DebugOptions = {
    stats: boolean
    vectors: boolean
    hitboxes: boolean
}

export const NO_DEBUG: DebugOptions = { stats: false, vectors: false, hitboxes: false }

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
    collider?: Collider
    mass = 1

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
        debug?: DebugOptions
    ): void

    // Called by CollisionManager whenever this entity's collider overlaps
    // another entity's collider (for both solid hits and triggers). No-op by
    // default — override in subclasses that care (damage, pickups, etc).
    onCollision(other: Entity): void {}

    setCollider(collider: Collider) {
        this.collider = collider
        collider.owner = this
    }

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

export class CollisionManager {
    update(entities: Entity[]) {
        for (let i = 0; i < entities.length; i++) {
            const a = entities[i];

            if (!a.collider) {
                continue;
            }

            for (let j = i + 1; j < entities.length; j++) {
                const b = entities[j];

                if (!b.collider) {
                    continue;
                }

                const manifold = computeManifold(a.collider, b.collider);

                if (!manifold) {
                    continue;
                }

                // Triggers report the overlap (onCollision below) but don't
                // push entities apart or exchange momentum.
                const isTrigger = a.collider.isTrigger || b.collider.isTrigger;

                if (!isTrigger) {
                    this.separate(a, b, manifold);
                    this.applyImpulse(a, b, manifold);
                }

                a.onCollision(b);
                b.onCollision(a);
            }
        }
    }

    private separate(
        a: Entity,
        b: Entity,
        manifold: Manifold
    ) {
        const correction =
            manifold.normal
                .clone()
                .multiply(manifold.penetration);

        const totalMass =
            a.mass + b.mass;

        const moveA =
            correction
                .clone()
                .multiply(-b.mass / totalMass);

        const moveB =
            correction
                .clone()
                .multiply(a.mass / totalMass);

        a.position.add(moveA);
        b.position.add(moveB);
    }

    private applyImpulse(
        a: Entity,
        b: Entity,
        manifold: Manifold
    ) {
        const relativeVelocity =
            b.velocity
                .clone()
                .subtract(a.velocity);

        const separatingVelocity =
            relativeVelocity.x * manifold.normal.x +
            relativeVelocity.y * manifold.normal.y;

        // Already moving apart
        if (separatingVelocity > 0) {
            return;
        }

        const restitution = 0.5;

        const impulseMagnitude =
            -(1 + restitution) *
            separatingVelocity /
            (
                (1 / a.mass) +
                (1 / b.mass)
            );

        const impulse =
            manifold.normal
                .clone()
                .multiply(impulseMagnitude);

        a.velocity.subtract(
            impulse
                .clone()
                .multiply(1 / a.mass)
        );

        b.velocity.add(
            impulse
                .clone()
                .multiply(1 / b.mass)
        );
    }
}

export abstract class Collider { // For collision with other entities
    owner: Entity

    constructor(
        public offset = new Vector2(),
        owner: Entity
    ) {
        this.owner = owner
    }

    // Triggers still fire onCollision but never affect physics — use them
    // for pickups, sensors, damage zones, etc.
    isTrigger = false

    // Implemented once here via computeManifold rather than per-subclass,
    // so circle/box math only exists in one place.
    intersects(other: Collider): boolean {
        return computeManifold(this, other) !== null;
    }

    abstract drawDebug(
        ctx: CanvasRenderingContext2D
    ): void;
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

    draw(ctx: CanvasRenderingContext2D, camera: Camera, debug: DebugOptions = NO_DEBUG) {
        for (const ship of this.ships) {
            ship.draw(ctx, camera, debug)
        }
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

    update(ship: Ship) {
        this.clearInput();

        let targetPos: Vector2 | null = null

        if (this.temporaryTarget) {
            targetPos = this.temporaryTarget()
        } else {
            if (this.target) targetPos = this.target()
        }

        if (!targetPos) return

        const desiredDistance = 200
        const distance = getDistance(ship.position, targetPos);

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

        const velocityError =
            desiredVelocity
                .clone()
                .subtract(ship.velocity);

        if (velocityError.getSpeed() > 0.5) {
            this.input.space = true;
        }

        if (this.temporaryTarget) {
            if (distance < 100) {
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
        ship: Ship,
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

    setTarget(newTarget: TargetProvider) {
        this.target = newTarget
    }

    setTemporaryTarget(newTarget: TargetProvider) {
        this.priorTarget = this.target
        this.temporaryTarget = newTarget
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

export class CircleCollider extends Collider {
    constructor(
        public radius: number,
        offset = new Vector2(),
        owner: Entity
    ) {
        super(offset, owner);
    }

    drawDebug(
        ctx: CanvasRenderingContext2D
    ) {
        ctx.save();

        ctx.translate(this.offset.x, this.offset.y);

        ctx.strokeStyle = "rgba(255, 0, 0, 0.45)";
        ctx.setLineDash([6, 6])
        ctx.lineWidth = .5;

        ctx.beginPath();
        ctx.arc(
            0,
            0,
            this.radius,
            0,
            Math.PI * 2
        );
        ctx.stroke();

        // Center point
        ctx.fillStyle = "#00ff00";
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

export class BoxCollider extends Collider {
    constructor(
        public width: number,
        public height: number,
        offset = new Vector2(),
        owner: Entity
    ) {
        super(offset, owner);
    }

    drawDebug(
        ctx: CanvasRenderingContext2D
    ) {
        ctx.save();

        ctx.translate(this.offset.x, this.offset.y);

        ctx.strokeStyle = "#00ff00";
        ctx.lineWidth = 2;

        ctx.strokeRect(
            -this.width / 2,
            -this.height / 2,
            this.width,
            this.height
        );

        // Center point
        ctx.fillStyle = "#00ff00";
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();

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