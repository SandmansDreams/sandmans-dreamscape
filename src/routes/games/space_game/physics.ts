import { SpatialHash } from "./broadphase";
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

    drawStats(ctx: CanvasRenderingContext2D, screenX: number, screenY: number) {
        const speed = this.velocity.getSpeed()
 
        // Direction as a compass-style degree reading, 0-360
        const directionDeg = ((this.rotation * 180 / Math.PI) % 360 + 360) % 360
 
        const lines = [
            `speed: ${speed.toFixed(2)}`,
            `rotation-speed: ${Math.round(this.rotationSpeed * 10000) / 100}`,
            `dir: ${directionDeg.toFixed(1)}°`,
            `pos: (${Math.round(this.position.x * 100) / 100}, ${Math.round(this.position.y * 100) / 100})`,
            `mass: ${this.mass}`
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
        const scale = 10

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

const RESTITUTION = 0.5;

export class CollisionManager {
    private hash: SpatialHash<PhysicsObject>;

    /**
     * @param cellSize should be around the diameter of a typical collider.
     *        Too small and big asteroids spill across many buckets; too large
     *        and each bucket degenerates back into a brute-force scan.
     */
    constructor(cellSize: number = 160) {
        this.hash = new SpatialHash(cellSize);
    }

    /**
     * Broadphase via a spatial hash, then exact narrowphase on the surviving
     * pairs. The previous all-pairs loop was O(n^2), which at a few hundred
     * bodies was the single most expensive thing in the frame.
     */
    update(objects: PhysicsObject[]) {
        this.hash.clear();

        for (const object of objects) {
            const collider = object.collider;
            if (!collider) continue;

            this.hash.insert(
                object,
                object.position.x + collider.offset.x,
                object.position.y + collider.offset.y,
                collider.boundingRadius
            );
        }

        this.hash.forEachPair(this.resolve);
    }

    // Bound method so it can be handed straight to forEachPair without
    // allocating a closure every frame.
    private resolve = (a: PhysicsObject, b: PhysicsObject) => {
        const manifold = computeManifold(a.collider!, b.collider!);
        if (!manifold) return;

        // Triggers report the overlap (onCollision below) but don't
        // push entities apart or exchange momentum.
        if (!a.collider!.isTrigger && !b.collider!.isTrigger) {
            const nx = manifold.normal.x;
            const ny = manifold.normal.y;
            this.separate(a, b, nx, ny, manifold.penetration);
            this.applyImpulse(a, b, nx, ny);
        }

        a.onCollision(b);
        b.onCollision(a);
    };

    private separate(
        a: PhysicsObject,
        b: PhysicsObject,
        nx: number,
        ny: number,
        penetration: number
    ) {
        const totalMass = a.mass + b.mass;
        const shareA = b.mass / totalMass;
        const shareB = a.mass / totalMass;

        const cx = nx * penetration;
        const cy = ny * penetration;

        a.position.x -= cx * shareA;
        a.position.y -= cy * shareA;
        b.position.x += cx * shareB;
        b.position.y += cy * shareB;
    }

    private applyImpulse(
        a: PhysicsObject,
        b: PhysicsObject,
        nx: number,
        ny: number
    ) {
        const separatingVelocity =
            (b.velocity.x - a.velocity.x) * nx +
            (b.velocity.y - a.velocity.y) * ny;

        // Already moving apart
        if (separatingVelocity > 0) {
            return;
        }

        const magnitude =
            -(1 + RESTITUTION) *
            separatingVelocity /
            ((1 / a.mass) + (1 / b.mass));

        a.velocity.x -= nx * magnitude / a.mass;
        a.velocity.y -= ny * magnitude / a.mass;
        b.velocity.x += nx * magnitude / b.mass;
        b.velocity.y += ny * magnitude / b.mass;
    }
}

/**
 * A collider occupies a frame: its origin is the owner's position displaced by
 * `offset`, and both that displacement and the collider's own axes are rotated
 * by `worldAngle`.
 *
 * The rotation matters. Offsets used to be added to the owner's position
 * verbatim, so an offset collider stayed put while its owner spun — harmless
 * only because nothing had a non-zero offset yet.
 */
export abstract class Collider { // For collision with other entities
    owner: PhysicsObject

    /**
     * Rotation between the owner's heading and this collider's axes.
     *
     * Ship hulls are authored nose-up while a rotation of 0 points along +X,
     * so their colliders carry the same quarter-turn their grids are drawn with.
     */
    angleOffset = 0

    constructor(
        public offset = new Vector2(),
        owner: PhysicsObject
    ) {
        this.owner = owner
    }

    // Triggers still fire onCollision but never affect physics — use them
    // for pickups, sensors, damage zones, etc.
    isTrigger = false

    get worldAngle(): number {
        return this.owner.rotation + this.angleOffset
    }

    get worldX(): number {
        if (this.offset.x === 0 && this.offset.y === 0) return this.owner.position.x
        const angle = this.worldAngle
        return this.owner.position.x + this.offset.x * Math.cos(angle) - this.offset.y * Math.sin(angle)
    }

    get worldY(): number {
        if (this.offset.x === 0 && this.offset.y === 0) return this.owner.position.y
        const angle = this.worldAngle
        return this.owner.position.y + this.offset.x * Math.sin(angle) + this.offset.y * Math.cos(angle)
    }

    /** Radius of a circle fully containing this collider, for broadphase insertion. */
    abstract get boundingRadius(): number;

    /** Exact containment test in world space, for projectile hits. */
    abstract containsPoint(x: number, y: number): boolean;

    // Implemented once here via computeManifold rather than per-subclass,
    // so circle/box math only exists in one place.
    intersects(other: Collider): boolean {
        return computeManifold(this, other) !== null;
    }

    /**
     * Draws into a context already translated to the owner's position, rotated
     * by the owner's rotation and scaled by the camera — implementations apply
     * their own angleOffset and offset on top.
     */
    abstract drawDebug(
        ctx: CanvasRenderingContext2D
    ): void;
}

export type Manifold = {
    normal: Vector2
    penetration: number
}

/**
 * Manifolds are consumed immediately by the caller that asked for them, so a
 * single reused instance saves two allocations per overlapping pair per frame.
 * Never hold on to the object returned by computeManifold.
 */
const scratchManifold: Manifold = { normal: new Vector2(), penetration: 0 };

function manifold(nx: number, ny: number, penetration: number): Manifold {
    scratchManifold.normal.x = nx;
    scratchManifold.normal.y = ny;
    scratchManifold.penetration = penetration;
    return scratchManifold;
}

function manifoldCircleCircle(
    a: CircleCollider,
    b: CircleCollider
): Manifold | null {

    const dx = b.worldX - a.worldX;
    const dy = b.worldY - a.worldY;

    const distance = Math.hypot(dx, dy);
    const radiusSum = a.radius + b.radius;

    if (distance >= radiusSum) {
        return null;
    }

    // Centers exactly overlapping: pick an arbitrary normal rather than
    // dividing by zero.
    return distance > 0
        ? manifold(dx / distance, dy / distance, radiusSum - distance)
        : manifold(1, 0, radiusSum);
}

/**
 * Separating Axis Theorem for two oriented boxes.
 *
 * Two rectangles are disjoint if and only if some axis perpendicular to an
 * edge of one of them separates them, so it suffices to test each box's two
 * local axes. The shallowest overlap among them is the minimum translation
 * vector, which is what the solver wants.
 */
function manifoldBoxBox(
    a: BoxCollider,
    b: BoxCollider
): Manifold | null {

    const dx = b.worldX - a.worldX;
    const dy = b.worldY - a.worldY;

    const angleA = a.worldAngle;
    const angleB = b.worldAngle;

    const cosA = Math.cos(angleA), sinA = Math.sin(angleA);
    const cosB = Math.cos(angleB), sinB = Math.sin(angleB);

    // Unit axes of each box: x along its width, y along its height.
    const axes = [
        cosA, sinA,
        -sinA, cosA,
        cosB, sinB,
        -sinB, cosB
    ];

    let bestOverlap = Infinity;
    let bestX = 0;
    let bestY = 0;

    for (let i = 0; i < 4; i++) {
        const nx = axes[i * 2];
        const ny = axes[i * 2 + 1];

        // Half-width of each box's shadow on this axis.
        const reachA =
            Math.abs(a.halfWidth * (cosA * nx + sinA * ny)) +
            Math.abs(a.halfHeight * (-sinA * nx + cosA * ny));

        const reachB =
            Math.abs(b.halfWidth * (cosB * nx + sinB * ny)) +
            Math.abs(b.halfHeight * (-sinB * nx + cosB * ny));

        const separation = dx * nx + dy * ny;
        const overlap = reachA + reachB - Math.abs(separation);

        // One clean axis is enough to prove they're apart.
        if (overlap <= 0) return null;

        if (overlap < bestOverlap) {
            bestOverlap = overlap;
            // Keep the normal pointing from a toward b.
            const sign = separation < 0 ? -1 : 1;
            bestX = nx * sign;
            bestY = ny * sign;
        }
    }

    return manifold(bestX, bestY, bestOverlap);
}

/**
 * Circle against an oriented box.
 *
 * Solved in the box's local frame, where it is axis-aligned and the usual
 * clamp-to-nearest-point test applies; the resulting normal is rotated back
 * into world space at the end.
 */
function manifoldCircleBox(
    circle: CircleCollider,
    box: BoxCollider
): Manifold | null {

    const angle = box.worldAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const dx = circle.worldX - box.worldX;
    const dy = circle.worldY - box.worldY;

    // Circle centre, expressed in the box's frame.
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;

    const hw = box.halfWidth;
    const hh = box.halfHeight;

    const closestX = localX < -hw ? -hw : localX > hw ? hw : localX;
    const closestY = localY < -hh ? -hh : localY > hh ? hh : localY;

    const offX = localX - closestX;
    const offY = localY - closestY;
    const distanceSq = offX * offX + offY * offY;

    if (distanceSq > circle.radius * circle.radius) {
        return null;
    }

    let localNx: number, localNy: number, penetration: number;

    if (distanceSq === 0) {
        // Circle's centre is inside the box, so the closest point IS the
        // centre and there's no direction to push along. Fall back to the
        // nearest face.
        const toLeft = localX + hw;
        const toRight = hw - localX;
        const toTop = localY + hh;
        const toBottom = hh - localY;

        const minOverlap = Math.min(toLeft, toRight, toTop, toBottom);

        if (minOverlap === toLeft) { localNx = -1; localNy = 0; }
        else if (minOverlap === toRight) { localNx = 1; localNy = 0; }
        else if (minOverlap === toTop) { localNx = 0; localNy = -1; }
        else { localNx = 0; localNy = 1; }

        penetration = minOverlap + circle.radius;
    } else {
        const distance = Math.sqrt(distanceSq);
        localNx = offX / distance;
        localNy = offY / distance;
        penetration = circle.radius - distance;
    }

    // Back to world space. Points box -> circle.
    return manifold(
        localNx * cos - localNy * sin,
        localNx * sin + localNy * cos,
        penetration
    );
}

export function computeManifold(a: Collider, b: Collider): Manifold | null {
    if (a instanceof CircleCollider) {
        if (b instanceof CircleCollider) return manifoldCircleCircle(a, b);

        if (b instanceof BoxCollider) {
            const m = manifoldCircleBox(a, b);
            // manifoldCircleBox always returns box -> circle (i.e. b -> a here).
            // Flip it so the result is consistently a -> b.
            if (m) {
                m.normal.x = -m.normal.x;
                m.normal.y = -m.normal.y;
            }
            return m;
        }

        return null;
    }

    if (a instanceof BoxCollider) {
        if (b instanceof BoxCollider) return manifoldBoxBox(a, b);
        // Already box -> circle, i.e. a -> b. No flip needed.
        if (b instanceof CircleCollider) return manifoldCircleBox(b, a);
    }

    return null;
}

export class CircleCollider extends Collider {
    constructor(
        public radius: number,
        offset = new Vector2(),
        owner: PhysicsObject
    ) {
        super(offset, owner);
    }

    get boundingRadius(): number {
        return this.radius;
    }

    containsPoint(x: number, y: number): boolean {
        const dx = x - this.worldX;
        const dy = y - this.worldY;
        return dx * dx + dy * dy <= this.radius * this.radius;
    }

    drawDebug(
        ctx: CanvasRenderingContext2D
    ) {
        ctx.save();

        ctx.rotate(this.angleOffset);
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

/**
 * An oriented box: `width` runs along the collider frame's local x axis and
 * `height` along its y, both rotating with the owner.
 */
export class BoxCollider extends Collider {
    constructor(
        public width: number,
        public height: number,
        offset = new Vector2(),
        owner: PhysicsObject
    ) {
        super(offset, owner);
    }

    get halfWidth(): number {
        return this.width / 2;
    }

    get halfHeight(): number {
        return this.height / 2;
    }

    get boundingRadius(): number {
        return Math.hypot(this.width, this.height) / 2;
    }

    containsPoint(x: number, y: number): boolean {
        const angle = this.worldAngle;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const dx = x - this.worldX;
        const dy = y - this.worldY;

        return Math.abs(dx * cos + dy * sin) <= this.halfWidth
            && Math.abs(-dx * sin + dy * cos) <= this.halfHeight;
    }

    drawDebug(
        ctx: CanvasRenderingContext2D
    ) {
        ctx.save();

        ctx.rotate(this.angleOffset);
        ctx.translate(this.offset.x, this.offset.y);

        ctx.strokeStyle = "#00ff00";
        ctx.lineWidth = 0.5;
        ctx.setLineDash([6, 6]);

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

