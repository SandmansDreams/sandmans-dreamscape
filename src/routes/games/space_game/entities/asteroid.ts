import { getRandomVector } from "../helpers"
import { CircleCollider, Vector2 } from "../physics"
import { Camera, NO_DEBUG, type DebugOptions } from "../types"
import { PhysicsObject } from "../physics"
import type { Entity } from "./entity"

const TWO_PI = Math.PI * 2

export interface AsteroidOptions {
    radius?: number
    mass?: number
    rotationSpeed?: number
    jaggedness?: number // 0-1, how irregular the outline is
}

export class Asteroid extends PhysicsObject {
    radius: number
    private outline: Vector2[]

    constructor(
        position: Vector2,
        velocity: Vector2 = new Vector2(0, 0),
        options: AsteroidOptions = {}
    ) {
        super(position, velocity, Math.random() * 30)

        this.radius = options.radius ?? 40

        this.mass = options.mass ?? this.radius * this.radius * 0.3

        this.drag = 1
        this.rotationDrag = 1
        this.rotationSpeed = options.rotationSpeed ?? (Math.random() - 0.5) * 0.01

        this.collider = new CircleCollider(this.radius, new Vector2(), this)

        this.outline = this.generateOutline(options.jaggedness ?? 0.35)
    }

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
        const { x, y } = camera.worldToScreen(this.position.x, this.position.y, ctx.canvas.clientWidth, ctx.canvas.clientHeight)

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(this.rotation)
        ctx.scale(camera.zoom, camera.zoom)

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
        ctx.lineWidth = 1
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

    onCollision(other: PhysicsObject): void {}
}

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

        const radius = options.radius ?? 20 + Math.random() * 60

        asteroids.push(new Asteroid(position, velocity, { ...options, radius }))
    }

    return asteroids
}