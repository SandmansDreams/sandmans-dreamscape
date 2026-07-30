import type { Cell } from "./grid"
import { angleDelta, CELL_SIZE } from "./helpers"
import { Particle } from "./particle"
import { Vector2 } from "./physics"
import type { DebugOptions } from "./types"

/** Shared empty result, so idle modules allocate nothing each frame. */
const NO_PARTICLES: Particle[] = []

export interface Targetable {
    position: Vector2
}

export type PlacementLevel = 1 | 2 | 3 | 4 | 5

/**
 * Everything a module needs to know about its host ship this frame.
 *
 * The host reuses a single instance and rewrites it per placement, so nothing
 * here may be retained past the update call that received it.
 */
export interface PlacementContext {
    /** World position of the cell this module is mounted in. */
    worldPos: Vector2
    /** The host's world rotation. */
    shipRotation: number
    /** The host's world velocity, so effects can be emitted in its frame. */
    velocityX: number
    velocityY: number
    /** -1 full reverse, 0 coasting, +1 full forward. */
    throttle: number
    /** Candidates that weapons may engage. */
    targets: Targetable[]
}

export abstract class Placement {
    level: PlacementLevel = 1
    rotation: number = 0
    cell: Cell | null = null
    color: string = "#555"

    abstract get displayName(): string
    abstract get description(): string
    abstract get weight(): number

    abstract update(delta: number, ctx: PlacementContext): Particle[]

    abstract draw(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        size: number
    ): void

    abstract drawDebug(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        size: number,
        debug: DebugOptions
    ): void
}

const TURRET_LEVELS = [
    { barrels: 1, fireRate: 30, label: "Turret I" },
    { barrels: 2, fireRate: 30, label: "Turret II" },
    { barrels: 3, fireRate: 30, label: "Turret III" },
    { barrels: 1, fireRate: 8, label: "Gatling" },
    { barrels: 2, fireRate: 5, label: "Twin Gatling" },
]

export class Turret extends Placement {
    range: number = 400
    cooldown: number = 0
    targetAngle: number = 0
    hasTarget: boolean = false
    barrelLength: number = 0.8
    projectileSpeed: number = 5
    projectileDamage: number = 5
    rotationSpeed: number = 0.08

    get displayName(): string { return TURRET_LEVELS[this.level - 1].label }
    get description(): string {
        const l = TURRET_LEVELS[this.level - 1]
        return `${l.barrels} barrel${l.barrels > 1 ? "s" : ""}, ${Math.round(60 / l.fireRate)} shots/s`
    }
    get weight(): number { return 2 + this.level }

    get barrelCount(): number { return TURRET_LEVELS[this.level - 1].barrels }
    get effectiveFireRate(): number { return TURRET_LEVELS[this.level - 1].fireRate }
    get isGatling(): boolean { return this.level >= 4 }

    update(delta: number, ctx: PlacementContext): Particle[] {
        const spawned: Particle[] = []
        const { worldPos, shipRotation, targets } = ctx

        this.cooldown = Math.max(0, this.cooldown - delta)

        let nearest: Targetable | null = null
        // Compared squared to keep the scan free of square roots.
        let nearestDistSq = this.range * this.range

        for (const target of targets) {
            const dx = target.position.x - worldPos.x
            const dy = target.position.y - worldPos.y
            const distSq = dx * dx + dy * dy
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq
                nearest = target
            }
        }

        if (nearest) {
            this.hasTarget = true
            const dx = nearest.position.x - worldPos.x
            const dy = nearest.position.y - worldPos.y
            const desiredAngle = Math.atan2(dy, dx) - shipRotation

            const error = angleDelta(this.rotation, desiredAngle)
            this.rotation += Math.sign(error) * Math.min(Math.abs(error), this.rotationSpeed * delta)

            const aimError = Math.abs(error)

            if (this.cooldown <= 0 && aimError < 0.15) {
                this.cooldown = this.effectiveFireRate
                const fireAngle = shipRotation + this.rotation
                const barrels = this.barrelCount

                if (barrels === 1) {
                    const vel = Vector2.fromAngle(fireAngle).multiply(this.projectileSpeed)
                    spawned.push(new Particle(worldPos.clone(), vel, 2, "#ffffff", 120, this.projectileDamage))
                } else {
                    const spread = 0.12
                    for (let i = 0; i < barrels; i++) {
                        const offset = (i - (barrels - 1) / 2) * spread
                        const vel = Vector2.fromAngle(fireAngle + offset).multiply(this.projectileSpeed)
                        spawned.push(new Particle(worldPos.clone(), vel, 2, "#ffffff", 120, this.projectileDamage))
                    }
                }
            }
        } else {
            this.hasTarget = false
        }

        return spawned
    }

    draw(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        size: number
    ) {
        const cx = x + size / 2
        const cy = y + size / 2
        const radius = size * 0.4

        ctx.save()
        ctx.translate(cx, cy)

        ctx.fillStyle = this.color
        ctx.beginPath()
        ctx.arc(0, 0, radius, 0, Math.PI * 2)
        ctx.fill()

        ctx.rotate(this.rotation)

        const barrels = this.barrelCount
        const shaftW = size * 0.06
        const shaftH = size * this.barrelLength
        const blockW = size * 0.1
        const blockH = size * 0.12

        if (this.isGatling) {
            if (barrels === 1) {
                ctx.fillStyle = "#888"
                ctx.fillRect(-shaftW, -shaftH, shaftW * 2, shaftH)
                ctx.fillStyle = "#4a9eff"
                ctx.fillRect(-blockW, -shaftH * 0.6 - blockH / 2, blockW * 2, blockH)
                ctx.fillStyle = "#666"
                ctx.fillRect(-blockW * 0.7, -shaftH * 0.35 - blockH * 0.3, blockW * 1.4, blockH * 0.6)
            } else {
                const gap = size * 0.08
                for (const side of [-1, 1]) {
                    const ox = side * gap
                    ctx.fillStyle = "#888"
                    ctx.fillRect(ox - shaftW, -shaftH, shaftW * 2, shaftH)
                    ctx.fillStyle = "#4a9eff"
                    ctx.fillRect(ox - blockW, -shaftH * 0.6 - blockH / 2, blockW * 2, blockH)
                }
                ctx.fillStyle = "#666"
                ctx.fillRect(-gap - blockW * 0.5, -shaftH * 0.35 - blockH * 0.3, (gap + blockW * 0.5) * 2, blockH * 0.6)
            }
        } else {
            if (barrels === 1) {
                ctx.fillStyle = "#888"
                ctx.fillRect(-shaftW, -shaftH, shaftW * 2, shaftH)
                ctx.fillStyle = "#4a9eff"
                ctx.fillRect(-blockW, -shaftH * 0.5 - blockH / 2, blockW * 2, blockH)
            } else {
                const totalSpread = (barrels - 1) * size * 0.1
                for (let i = 0; i < barrels; i++) {
                    const ox = (i - (barrels - 1) / 2) * size * 0.1
                    ctx.fillStyle = "#888"
                    ctx.fillRect(ox - shaftW, -shaftH, shaftW * 2, shaftH)
                }
                ctx.fillStyle = "#4a9eff"
                ctx.fillRect(-totalSpread / 2 - blockW, -shaftH * 0.5 - blockH / 2, totalSpread + blockW * 2, blockH)
            }
        }

        ctx.restore()
    }

    drawDebug(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        size: number,
        debug: DebugOptions
    ) {
        if (!debug.hitboxes) return

        const cx = x + size / 2
        const cy = y + size / 2

        ctx.save()
        ctx.translate(cx, cy)

        ctx.strokeStyle = "rgba(255, 255, 0, 0.3)"
        ctx.setLineDash([4, 4])
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.arc(0, 0, this.range, 0, Math.PI * 2)
        ctx.stroke()

        if (this.hasTarget) {
            ctx.strokeStyle = "rgba(255, 0, 0, 0.5)"
            ctx.setLineDash([])
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(0, 0)
            const len = this.range * 0.5
            ctx.lineTo(
                Math.cos(this.rotation - Math.PI / 2) * len,
                Math.sin(this.rotation - Math.PI / 2) * len
            )
            ctx.stroke()
        }

        ctx.restore()
    }
}

export class Spike extends Placement {
    contactDamage: number = 10

    get displayName(): string { return `Spike ${["I", "II", "III", "IV", "V"][this.level - 1]}` }
    get description(): string { return `${this.contactDamage * this.level} contact damage` }
    get weight(): number { return 1 + this.level }
    get effectiveDamage(): number { return this.contactDamage * this.level }

    update(_delta: number, _ctx: PlacementContext): Particle[] {
        return NO_PARTICLES
    }

    draw(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        size: number
    ) {
        const cx = x + size / 2
        const cy = y + size / 2
        const r = size * 0.4

        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(this.rotation)

        ctx.fillStyle = this.color
        ctx.beginPath()
        ctx.moveTo(0, -r * 1.3)
        ctx.lineTo(-r * 0.5, r * 0.4)
        ctx.lineTo(r * 0.5, r * 0.4)
        ctx.closePath()
        ctx.fill()

        ctx.fillStyle = "#ccc"
        ctx.beginPath()
        ctx.moveTo(0, -r * 1.3)
        ctx.lineTo(-r * 0.15, -r * 0.3)
        ctx.lineTo(r * 0.15, -r * 0.3)
        ctx.closePath()
        ctx.fill()

        ctx.restore()
    }

    drawDebug(
        _ctx: CanvasRenderingContext2D,
        _x: number,
        _y: number,
        _size: number,
        _debug: DebugOptions
    ) {}
}

/** Exhaust plume tuning. */
const EXHAUST_RATE = 0.8         // particles per frame at full throttle
const EXHAUST_SPEED = 1.6        // world units per frame, away from the nozzle
const EXHAUST_SPREAD = 0.35      // radians of cone half-angle
const EXHAUST_LIFETIME = 14      // frames
const EXHAUST_COLORS = ["#ffcc00", "#ff9944", "#ff6600", "#ffe9a8"]

export class Thruster extends Placement {
    thrustPower: number = 0.05

    /**
     * Fractional particles carried between frames, so the emission rate is
     * tied to elapsed time rather than to how often update happens to run.
     */
    private emissionDebt = 0

    get displayName(): string { return `Thruster ${["I", "II", "III", "IV", "V"][this.level - 1]}` }
    get description(): string { return `+${(this.thrustPower * this.level).toFixed(2)} thrust` }
    get weight(): number { return 3 + this.level }
    get effectiveThrust(): number { return this.thrustPower * this.level }

    update(delta: number, ctx: PlacementContext): Particle[] {
        const throttle = ctx.throttle

        if (throttle === 0) {
            // Don't bank up a plume while coasting.
            this.emissionDebt = 0
            return NO_PARTICLES
        }

        const power = Math.abs(throttle)
        this.emissionDebt += EXHAUST_RATE * power * delta

        const count = Math.floor(this.emissionDebt)
        if (count <= 0) return NO_PARTICLES
        this.emissionDebt -= count

        // Exhaust leaves opposite the thrust, so reversing flips the plume.
        const exhaustAngle = ctx.shipRotation + (throttle > 0 ? Math.PI : 0)
        const speed = EXHAUST_SPEED * (0.6 + 0.4 * power)

        const spawned: Particle[] = []

        for (let i = 0; i < count; i++) {
            const angle = exhaustAngle + (Math.random() * 2 - 1) * EXHAUST_SPREAD
            const magnitude = speed * (0.7 + Math.random() * 0.6)

            spawned.push(new Particle(
                ctx.worldPos.clone(),
                // Emitted in the ship's frame, so the plume trails the hull
                // instead of being left behind in a straight line.
                new Vector2(
                    ctx.velocityX + Math.cos(angle) * magnitude,
                    ctx.velocityY + Math.sin(angle) * magnitude
                ),
                CELL_SIZE * (0.25 + Math.random() * 0.3),
                EXHAUST_COLORS[Math.floor(Math.random() * EXHAUST_COLORS.length)],
                EXHAUST_LIFETIME * (0.5 + Math.random() * 0.5),
                0
            ))
        }

        return spawned
    }

    draw(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        size: number
    ) {
        const cx = x + size / 2
        const cy = y + size / 2
        const r = size * 0.35

        ctx.save()
        ctx.translate(cx, cy)

        ctx.fillStyle = this.color
        ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2)

        ctx.fillStyle = "#ff6600"
        ctx.beginPath()
        ctx.moveTo(-r * 0.6, r * 0.6)
        ctx.lineTo(0, r * 1.2)
        ctx.lineTo(r * 0.6, r * 0.6)
        ctx.closePath()
        ctx.fill()

        ctx.fillStyle = "#ffcc00"
        ctx.beginPath()
        ctx.moveTo(-r * 0.3, r * 0.6)
        ctx.lineTo(0, r * 1.0)
        ctx.lineTo(r * 0.3, r * 0.6)
        ctx.closePath()
        ctx.fill()

        ctx.restore()
    }

    drawDebug(
        _ctx: CanvasRenderingContext2D,
        _x: number,
        _y: number,
        _size: number,
        _debug: DebugOptions
    ) {}
}
