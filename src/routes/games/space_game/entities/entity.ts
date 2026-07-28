import { Collider, Vector2 } from "../physics"
import type { Camera, DebugOptions } from "../types"

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

