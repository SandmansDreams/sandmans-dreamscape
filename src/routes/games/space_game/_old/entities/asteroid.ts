import type { SurfaceLight } from "../lighting"
import { Grid } from "../grid"
import type { BlockShape } from "../shapes"
import { CircleCollider, Vector2 } from "../physics"
import { Camera, NO_DEBUG, type DebugOptions } from "../types"
import { PhysicsObject } from "../physics"
import { CELL_SIZE, getRandomIntFromRange } from "../helpers"
import { drawHealthBar } from "../hud"

export interface AsteroidOptions {
    radius?: number
    rotationSpeed?: number
    jaggedness?: number
}

/** Base palette, pre-split so shape generation never parses a colour string. */
const ASTEROID_COLORS: { h: number, s: number, l: number }[] = [
    { h: 37, s: 9, l: 38 },
    { h: 37, s: 9, l: 44 },
    { h: 34, s: 9, l: 34 },
    { h: 34, s: 9, l: 48 },
    { h: 42, s: 12, l: 39 }
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
        super(position, velocity, Math.random() * Math.PI * 2)

        this.radius = options.radius ?? getRandomIntFromRange(5, 40)
        this.mass = this.radius * this.radius

        this.maxHealth = Math.round(this.radius * 2)
        this.health = this.maxHealth

        this.drag = 1
        this.rotationDrag = 1
        this.rotationSpeed = options.rotationSpeed ?? (Math.random() - 0.5) * 0.02

        this.gridDim = Math.ceil(this.radius * 2 / CELL_SIZE) + 2
        this.grid = new Grid()
        this.generateShape(options.jaggedness ?? 0.35)

        this.collider = new CircleCollider(this.radius, new Vector2(), this)
    }

    /** Asteroid grids are drawn axis-aligned, so grid space is just hull space. */
    get lightRotation(): number {
        return this.rotation
    }

    /**
     * Extent of the drawn shape, which overshoots `radius` because the grid is
     * quantised to whole cells. Used for view culling so tiles don't pop.
     */
    get drawRadius(): number {
        return this.grid.getBoundingRadius()
    }

    /** Radius used for projectile hit tests. */
    get hitRadius(): number {
        return this.radius
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

        const base = ASTEROID_COLORS[Math.floor(Math.random() * ASTEROID_COLORS.length)]
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

        for (let row = 0; row < this.gridDim; row++) {
            for (let col = 0; col < this.gridDim; col++) {
                const x = col * s
                const y = row * s

                // Marching-squares-ish: sample the silhouette at the cell's
                // four corners and pick a tile that approximates the edge.
                const nw = isInside(x, y)
                const ne = isInside(x + s, y)
                const sw = isInside(x, y + s)
                const se = isInside(x + s, y + s)

                const inside = (nw ? 1 : 0) + (ne ? 1 : 0) + (sw ? 1 : 0) + (se ? 1 : 0)
                if (inside === 0) continue

                // Two or more corners inside reads as solid at this cell size;
                // a lone corner gets an arc so the silhouette stays rounded.
                let shape: BlockShape
                if (inside >= 2) shape = "full"
                else if (nw) shape = "arcNW"
                else if (ne) shape = "arcNE"
                else if (sw) shape = "arcSW"
                else shape = "arcSE"

                const cellCx = x + s / 2
                const cellCy = y + s / 2
                const inCrater = craters.some(cr => Math.hypot(cellCx - cr.cx, cellCy - cr.cy) < cr.r)

                const lightness = inCrater
                    ? Math.max(5, base.l - getRandomIntFromRange(8, 14) + getRandomIntFromRange(-4, 4))
                    : Math.max(5, Math.min(95, base.l + getRandomIntFromRange(-4, 4)))
                const saturation = Math.max(0, Math.min(100, base.s + getRandomIntFromRange(-3, 3)))

                const cell = this.grid.getCell(col, row)
                this.grid.setCell(cell, shape, `hsl(${base.h}, ${saturation}%, ${lightness}%)`, null)
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
        this.position.x += this.velocity.x * delta
        this.position.y += this.velocity.y * delta
    }

    draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera,
        debug: DebugOptions = NO_DEBUG,
        light?: SurfaceLight
    ) {
        const { x, y } = camera.worldToScreen(this.position.x, this.position.y, ctx.canvas.clientWidth, ctx.canvas.clientHeight)

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(this.rotation)
        ctx.scale(camera.zoom, camera.zoom)

        const center = this.grid.getCenter()
        ctx.translate(-center.x, -center.y)
        this.grid.draw(ctx, 1, false, light)

        if (debug.hitboxes) {
            ctx.translate(center.x, center.y)
            this.collider?.drawDebug(ctx)
        }

        ctx.restore()

        drawHealthBar(ctx, x, y, this.radius, camera.zoom, this.health, this.maxHealth)

        if (debug.stats) {
            this.drawStats(ctx, x, y)
        }

        if (debug.vectors) {
            this.drawVelocityVector(ctx, x, y)
        }
    }

    onCollision(_other: PhysicsObject): void {}
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
