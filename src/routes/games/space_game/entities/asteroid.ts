import { computeGridLight, type GridLightInfo, type LightSource } from "../lighting"
import { ShipGrid, type BlockShape } from "../builder"
import { CircleCollider, Vector2 } from "../physics"
import { Camera, NO_DEBUG, type DebugOptions } from "../types"
import { PhysicsObject } from "../physics"

export interface AsteroidOptions {
    radius?: number
    mass?: number
    rotationSpeed?: number
    jaggedness?: number
}

const ASTEROID_COLORS = [
    "#6b6459", "#7a7265", "#5e574e", "#847b6f", "#6f6858"
]

export class Asteroid extends PhysicsObject {
    radius: number
    grid: ShipGrid
    health: number
    maxHealth: number
    dead: boolean = false

    constructor(
        position: Vector2,
        velocity: Vector2 = new Vector2(0, 0),
        options: AsteroidOptions = {}
    ) {
        super(position, velocity, Math.random() * 30)

        this.radius = options.radius ?? 40

        this.mass = options.mass ?? this.radius * this.radius * 0.3
        this.maxHealth = Math.round(this.radius * 2)
        this.health = this.maxHealth

        this.drag = 1
        this.rotationDrag = 1
        this.rotationSpeed = options.rotationSpeed ?? (Math.random() - 0.5) * 0.01

        const cellSize = Math.max(4, Math.round(this.radius / 5))
        const gridDim = Math.ceil(this.radius * 2 / cellSize) + 2
        this.grid = new ShipGrid(gridDim * cellSize, gridDim * cellSize, cellSize)
        this.generateShape(options.jaggedness ?? 0.35)

        this.collider = new CircleCollider(this.radius, new Vector2(), this)
    }

    private generateShape(jaggedness: number) {
        const center = this.grid.getCenter()
        const cx = center.x
        const cy = center.y

        const vertexCount = 10 + Math.floor(Math.random() * 4)
        const radii: number[] = []
        for (let i = 0; i < vertexCount; i++) {
            const wobble = 1 - jaggedness / 2 + Math.random() * jaggedness
            radii.push(this.radius * wobble)
        }

        const baseColor = ASTEROID_COLORS[Math.floor(Math.random() * ASTEROID_COLORS.length)]
        const s = this.grid.cellSize

        const edgeRadiusAt = (px: number, py: number): number => {
            const dx = px - cx
            const dy = py - cy
            const angle = Math.atan2(dy, dx)
            const norm = ((angle / (Math.PI * 2)) % 1 + 1) % 1
            const idx = norm * vertexCount
            const i0 = Math.floor(idx) % vertexCount
            const i1 = (i0 + 1) % vertexCount
            const t = idx - Math.floor(idx)
            return radii[i0] * (1 - t) + radii[i1] * t
        }

        const isInside = (px: number, py: number): boolean => {
            const dx = px - cx
            const dy = py - cy
            return Math.hypot(dx, dy) < edgeRadiusAt(px, py)
        }

        const cols = this.grid.nominalCols
        const rows = this.grid.nominalRows
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = col * s
                const y = row * s

                const nw = isInside(x, y)
                const ne = isInside(x + s, y)
                const sw = isInside(x, y + s)
                const se = isInside(x + s, y + s)

                const count = +nw + +ne + +sw + +se

                if (count === 0) continue

                let shape: BlockShape

                if (count === 4) {
                    shape = "full"
                } else if (count === 3) {
                    shape = "full"
                } else if (count === 2) {
                    shape = "full"
                } else {
                    if (nw) shape = "arcNW"
                    else if (ne) shape = "arcNE"
                    else if (sw) shape = "arcSW"
                    else shape = "arcSE"
                }

                const cell = this.grid.getCell(col, row)
                this.grid.setCell(cell, shape, baseColor, null)
            }
        }
    }

    takeDamage(amount: number): void {
        this.health -= amount
        if (this.health <= 0) {
            this.dead = true
        }
    }

    split(): Asteroid[] {
        if (this.grid.filledCount < 10) return []

        const count = 2 + Math.floor(Math.random() * 6)
        const children: Asteroid[] = []

        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.5
            const childRadius = this.radius * (0.2 + Math.random() * 0.3)

            if (childRadius < 8) continue

            const spawnDist = this.radius * 0.5
            const childPos = new Vector2(
                this.position.x + Math.cos(angle) * spawnDist,
                this.position.y + Math.sin(angle) * spawnDist
            )

            const outwardSpeed = 0.5 + Math.random() * 1.5
            const childVel = new Vector2(
                this.velocity.x + Math.cos(angle) * outwardSpeed,
                this.velocity.y + Math.sin(angle) * outwardSpeed
            )

            children.push(new Asteroid(childPos, childVel, {
                radius: childRadius,
                rotationSpeed: (Math.random() - 0.5) * 0.03
            }))
        }

        return children
    }

    update(delta: number) {
        this.rotation += this.rotationSpeed * delta
        this.position.add(this.velocity.clone().multiply(delta))
    }

    draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera,
        debug: DebugOptions = NO_DEBUG,
        lightInfo?: GridLightInfo
    ) {
        const { x, y } = camera.worldToScreen(this.position.x, this.position.y, ctx.canvas.clientWidth, ctx.canvas.clientHeight)

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(this.rotation)
        ctx.scale(camera.zoom, camera.zoom)

        const center = this.grid.getCenter()
        ctx.translate(-center.x, -center.y)
        this.grid.draw(ctx, 1, false, lightInfo)

        ctx.restore()

        if (debug.hitboxes) {
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate(this.rotation)
            ctx.scale(camera.zoom, camera.zoom)
            this.collider?.drawDebug(ctx)
            ctx.restore()
        }

        if (this.health < this.maxHealth) {
            this.drawHealthBar(ctx, x, y, camera)
        }

        if (debug.stats) {
            this.drawStats(ctx, x, y)
        }

        if (debug.vectors) {
            this.drawVelocityVector(ctx, x, y)
        }
    }

    private drawHealthBar(ctx: CanvasRenderingContext2D, screenX: number, screenY: number, camera: Camera) {
        const barWidth = this.radius * 2 * camera.zoom * 0.8
        const barHeight = 3
        const yOffset = -this.radius * camera.zoom - 8

        const x = screenX - barWidth / 2
        const y = screenY + yOffset

        const healthPct = Math.max(0, this.health / this.maxHealth)

        ctx.fillStyle = "rgba(0, 0, 0, 0.5)"
        ctx.fillRect(x, y, barWidth, barHeight)

        const r = Math.round(255 * (1 - healthPct))
        const g = Math.round(255 * healthPct)
        ctx.fillStyle = `rgb(${r}, ${g}, 50)`
        ctx.fillRect(x, y, barWidth * healthPct, barHeight)
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

        const velocity = new Vector2(
            (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.3
        )

        const radius = options.radius ?? 20 + Math.random() * 60

        asteroids.push(new Asteroid(position, velocity, { ...options, radius }))
    }

    return asteroids
}
