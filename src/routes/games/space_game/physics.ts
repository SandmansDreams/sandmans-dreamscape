import type { Camera, DebugOptions } from "./types";

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

export abstract class PhysicsObject {
    position: Vector2 = new Vector2(0, 0)
    velocity: Vector2 = new Vector2(0, 0)
    drag: number = 0.9999
    rotation: number = 0
    rotationDrag: number = 0.9999
    rotationSpeed: number = 0
    mass: number = 1
    collider?: Collider

    constructor(position: Vector2, velocity: Vector2, rotation = 0) {
        this.position = position
        this.velocity = velocity
        this.rotation = rotation
    }

    abstract update(delta: number): void

    abstract draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera,
        debug?: DebugOptions
    ): void

    abstract onCollision(other: PhysicsObject): void // If something should happen on collision aside from bouncing off

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
    update(objects: PhysicsObject[]) {
        for (let i = 0; i < objects.length; i++) {
            const a = objects[i];

            if (!a.collider) {
                continue;
            }

            for (let j = i + 1; j < objects.length; j++) {
                const b = objects[j];

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
        a: PhysicsObject,
        b: PhysicsObject,
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
        a: PhysicsObject,
        b: PhysicsObject,
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
    owner: PhysicsObject

    constructor(
        public offset = new Vector2(),
        owner: PhysicsObject
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

export function circleCircle(a: CircleCollider, b: CircleCollider): boolean {
    return manifoldCircleCircle(a, b) !== null;
}

export function boxBox(a: BoxCollider, b: BoxCollider): boolean {
    return manifoldBoxBox(a, b) !== null;
}

export function circleBox(circle: CircleCollider, box: BoxCollider): boolean {
    return manifoldCircleBox(circle, box) !== null;
}

export class CircleCollider extends Collider {
    constructor(
        public radius: number,
        offset = new Vector2(),
        owner: PhysicsObject
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
        owner: PhysicsObject
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

