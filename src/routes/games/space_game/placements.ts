import type { Cell } from "./builder"
import { Particle } from "./particle"
import { Vector2 } from "./physics"
import type { Camera, DebugOptions } from "./types"

export interface Targetable {
    position: Vector2
}

type PlacementLevel = "basic" | "average" | "advanced" | "extreme" | "max"

export abstract class Placement {
    level: PlacementLevel = "basic"
    rotation: number = 0
    cell: Cell | null = null

    abstract update(
        delta: number,
        worldPos: Vector2,
        shipRotation: number,
        targets: Targetable[]
    ): Particle[]

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

export class Turret extends Placement {
    range: number = 400
    fireRate: number = 30
    cooldown: number = 0
    targetAngle: number = 0
    hasTarget: boolean = false
    barrelLength: number = 0.8
    projectileSpeed: number = 5
    projectileDamage: number = 5
    rotationSpeed: number = 0.08

    update(
        delta: number,
        worldPos: Vector2,
        shipRotation: number,
        targets: Targetable[]
    ): Particle[] {
        const spawned: Particle[] = []

        this.cooldown = Math.max(0, this.cooldown - delta)

        let nearest: Targetable | null = null
        let nearestDist = this.range

        for (const target of targets) {
            const dx = target.position.x - worldPos.x
            const dy = target.position.y - worldPos.y
            const dist = Math.hypot(dx, dy)
            if (dist < nearestDist) {
                nearestDist = dist
                nearest = target
            }
        }

        if (nearest) {
            this.hasTarget = true
            const dx = nearest.position.x - worldPos.x
            const dy = nearest.position.y - worldPos.y
            const desiredAngle = Math.atan2(dy, dx) - shipRotation

            let error = desiredAngle - this.rotation
            error = Math.atan2(Math.sin(error), Math.cos(error))
            this.rotation += Math.sign(error) * Math.min(Math.abs(error), this.rotationSpeed * delta)

            const aimError = Math.abs(error)

            if (this.cooldown <= 0 && aimError < 0.15) {
                this.cooldown = this.fireRate
                const fireAngle = shipRotation + this.rotation
                const vel = Vector2.fromAngle(fireAngle).multiply(this.projectileSpeed)
                spawned.push(new Particle(
                    worldPos.clone(),
                    vel,
                    2,
                    "#ffffff",
                    120,
                    this.projectileDamage
                ))
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

        // Base circle
        ctx.fillStyle = "#555"
        ctx.beginPath()
        ctx.arc(0, 0, radius, 0, Math.PI * 2)
        ctx.fill()

        // Barrel
        ctx.rotate(this.rotation)
        ctx.fillStyle = "#888"
        ctx.fillRect(-size * 0.06, -size * this.barrelLength, size * 0.12, size * this.barrelLength)

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

        // Range circle
        ctx.strokeStyle = "rgba(255, 255, 0, 0.3)"
        ctx.setLineDash([4, 4])
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.arc(0, 0, this.range, 0, Math.PI * 2)
        ctx.stroke()

        // Target line
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
