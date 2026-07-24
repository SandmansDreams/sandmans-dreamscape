import { getRandomVector } from "../helpers"
import { Vector2, Entity, CircleCollider, Camera, NO_DEBUG, type DebugOptions } from "../types"

const TWO_PI = Math.PI * 2

export interface AsteroidOptions {
    radius?: number
    mass?: number
    rotationSpeed?: number
    jaggedness?: number // 0-1, how irregular the outline is
}

export class Asteroid extends Entity {
    radius: number
    private outline: Vector2[]

    constructor(
        position: Vector2,
        velocity: Vector2 = new Vector2(0, 0),
        options: AsteroidOptions = {}
    ) {
        super(position, getRandomVector(1, 1), Math.random() * TWO_PI)

        this.radius = options.radius ?? 40

        // Mass scales with area (~radius^2) rather than being a flat
        // number, so a big rock actually feels proportionally heavier
        // than a small one, not just visually bigger. A ship (mass 10)
        // colliding with even a small asteroid should barely nudge it.
        this.mass = options.mass ?? this.radius * this.radius * 0.3

        // Free-floating rock: nothing is thrusting against drag, so there's
        // no reason for it to lose momentum over time like a ship does.
        this.drag = 1
        this.rotationDrag = 1
        this.rotationSpeed = options.rotationSpeed ?? (Math.random() - 0.5) * 0.01

        this.collider = new CircleCollider(this.radius, new Vector2(), this)

        this.outline = this.generateOutline(options.jaggedness ?? 0.35)
    }

    // Precomputes an irregular polygon once at spawn time so the rock has a
    // consistent (non-circular) silhouette instead of redrawing a perfect
    // circle every frame.
    private generateOutline(jaggedness: number): Vector2[] {
        const points: Vector2[] = []
        const vertexCount = 10 + Math.floor(Math.random() * 4)

        for (let i = 0; i < vertexCount; i++) {
            const angle = (i / vertexCount) * TWO_PI
            const wobble = 1 - jaggedness / 2 + Math.random() * jaggedness
            points.push(Vector2.fromAngle(angle).multiply(this.radius * wobble))
        }

        return points
    }

    update(delta: number) {
        // No controller, no thrust - just drift and tumble.
        this.rotation += this.rotationSpeed * delta
        this.position.add(this.velocity.clone().multiply(delta))
    }

    draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera,
        debug: DebugOptions = NO_DEBUG
    ) {
        const x = this.position.x - camera.position.x + ctx.canvas.clientWidth / 2
        const y = this.position.y - camera.position.y + ctx.canvas.clientHeight / 2

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(this.rotation)

        ctx.beginPath()
        this.outline.forEach((point, i) => {
            if (i === 0) {
                ctx.moveTo(point.x, point.y)
            } else {
                ctx.lineTo(point.x, point.y)
            }
        })
        ctx.closePath()

        ctx.fillStyle = "#6b6459"
        ctx.fill()
        ctx.strokeStyle = "#3a362f"
        ctx.lineWidth = 2
        ctx.stroke()

        if (debug.hitboxes) {
            this.collider?.drawDebug(ctx)
        }

        ctx.restore()

        if (debug.stats) {
            this.drawStats(ctx, x, y)
        }

        if (debug.vectors) {
            this.drawVelocityVector(ctx, x, y)
        }
    }
}

// Convenience spawner for scattering a field of asteroids around the
// origin. `areaWidth`/`areaHeight` describe the total spread, centered on
// (0, 0) - e.g. spawnAsteroidField(20, 4000, 4000) spreads 20 rocks across
// a 4000x4000 region.
export function spawnAsteroidField(
    count: number,
    areaWidth: number,
    areaHeight: number,
    options: AsteroidOptions = {}
): Asteroid[] {
    const asteroids: Asteroid[] = []

    for (let i = 0; i < count; i++) {
        const position = new Vector2(
            (Math.random() - 0.5) * areaWidth,
            (Math.random() - 0.5) * areaHeight
        )

        // Gentle, slow drift - these are big rocks, not projectiles.
        const velocity = new Vector2(
            (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.3
        )

        const radius = options.radius ?? 20 + Math.random() * 40

        asteroids.push(new Asteroid(position, velocity, { ...options, radius }))
    }

    return asteroids
}