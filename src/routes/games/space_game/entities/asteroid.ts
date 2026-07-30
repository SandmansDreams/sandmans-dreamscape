import { computeGridLight, type GridLightInfo, type LightSource } from "../lighting"
import { Grid as Grid, type BlockShape } from "../grid"
import { CircleCollider, Vector2 } from "../physics"
import { Camera, NO_DEBUG, type DebugOptions } from "../types"
import { PhysicsObject } from "../physics"
import { CELL_SIZE, getRandomIntFromRange } from "../helpers"

export interface AsteroidOptions {
    radius?: number
    rotationSpeed?: number
    jaggedness?: number
}

const ASTEROID_COLORS = [
    "hsl(37, 9%, 38%)", 
    "hsl(37, 9%, 44%)", 
    "hsl(34, 9%, 34%)", 
    "hsl(34, 9%, 48%)", 
    "hsl(42, 12%, 39%)"
]

export class Asteroid extends PhysicsObject {
    radius: number
    grid: Grid
    gridDim: number
    health: number
    maxHealth: number
    dead: boolean = false

    constructor(
        position: Vector2,
        velocity: Vector2 = new Vector2(0, 0),
        options: AsteroidOptions = {}
    ) {
        super(position, velocity, Math.random() * 30)

        this.radius = options.radius ?? getRandomIntFromRange(5, 40)
        this.mass = this.radius * this.radius 

        this.maxHealth = Math.round(this.radius)
        this.health = this.maxHealth

        this.drag = 1
        this.rotationDrag = 1
        this.rotationSpeed = options.rotationSpeed ?? (Math.random() - 0.5) * 0.02

        this.gridDim = Math.ceil(this.radius * 2 / CELL_SIZE) + 2
        this.grid = new Grid()
        this.generateShape(options.jaggedness ?? 0.35)

        this.collider = new CircleCollider(this.radius, new Vector2(), this)
    }

    private generateShape(jaggedness: number) {
        const cx = (this.gridDim * CELL_SIZE) / 2
        const cy = cx

        const vertexCount = 10 + Math.floor(Math.random() * 4)
        const radii: number[] = []
        for (let i = 0; i < vertexCount; i++) {
            const wobble = 1 - jaggedness / 2 + Math.random() * jaggedness
            radii.push(this.radius * wobble)
        }

        const baseColor = ASTEROID_COLORS[Math.floor(Math.random() * ASTEROID_COLORS.length)]
        const baseMatch = baseColor.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/)
        const baseH = baseMatch ? parseInt(baseMatch[1]) : 37
        const baseS = baseMatch ? parseInt(baseMatch[2]) : 9
        const baseL = baseMatch ? parseInt(baseMatch[3]) : 40
        const s = CELL_SIZE

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

        const craterCount = Math.max(2, Math.floor(this.radius / 10))
        const craters: { cx: number, cy: number, r: number }[] = []
        for (let i = 0; i < craterCount; i++) {
            const angle = Math.random() * Math.PI * 2
            const dist = Math.random() * this.radius
            craters.push({
                cx: cx + Math.cos(angle) * dist,
                cy: cy + Math.sin(angle) * dist,
                r: this.radius * (0.1 + Math.random() * 0.15)
            })
        }

        const cols = this.gridDim
        const rows = this.gridDim
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

                const cellCx = x + s / 2
                const cellCy = y + s / 2
                const inCrater = craters.some(cr => Math.hypot(cellCx - cr.cx, cellCy - cr.cy) < cr.r)

                const lVariation = getRandomIntFromRange(-4, 4)
                const sVariation = getRandomIntFromRange(-3, 3)
                const cellL = inCrater
                    ? Math.max(5, baseL - getRandomIntFromRange(8, 14) + lVariation)
                    : Math.max(5, Math.min(95, baseL + lVariation))
                const cellS = Math.max(0, Math.min(100, baseS + sVariation))
                const cellColor = `hsl(${baseH}, ${cellS}%, ${cellL}%)`

                const cell = this.grid.getCell(col, row)
                this.grid.setCell(cell, shape, cellColor, null)
                if (inCrater) cell.invertLight = true
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
