import { Vector2 } from "./physics"
import type { Camera } from "./types"

export class Particle {
    position: Vector2
    velocity: Vector2
    lifetime: number
    age: number = 0
    size: number
    color: string
    damage: number
    dead: boolean = false

    constructor(
        position: Vector2,
        velocity: Vector2,
        size: number = 2,
        color: string = "#ffffff",
        lifetime: number = 120,
        damage: number = 5
    ) {
        this.position = position
        this.velocity = velocity
        this.size = size
        this.color = color
        this.lifetime = lifetime
        this.damage = damage
    }

    update(delta: number) {
        this.position.add(this.velocity.clone().multiply(delta))
        this.age += delta
        if (this.age >= this.lifetime) {
            this.dead = true
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: Camera) {
        const { x, y } = camera.worldToScreen(
            this.position.x, this.position.y,
            ctx.canvas.clientWidth, ctx.canvas.clientHeight
        )

        const s = this.size * camera.zoom
        const alpha = 1 - this.age / this.lifetime

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.fillStyle = this.color
        ctx.fillRect(x - s / 2, y - s / 2, s, s)
        ctx.restore()
    }
}

const EXPLOSION_COLORS = ["#ff4400", "#ff8800", "#ffcc00", "#ffffff", "#ff6633"]

export function spawnExplosion(
    position: Vector2,
    count: number = 20,
    speed: number = 2,
    size: number = 3,
    lifetime: number = 30
): Particle[] {
    const particles: Particle[] = []
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const spd = (0.3 + Math.random() * 0.7) * speed
        const vel = new Vector2(Math.cos(angle) * spd, Math.sin(angle) * spd)
        const s = (0.5 + Math.random() * 0.5) * size
        const lt = (0.5 + Math.random() * 0.5) * lifetime
        const color = EXPLOSION_COLORS[Math.floor(Math.random() * EXPLOSION_COLORS.length)]
        particles.push(new Particle(position.clone(), vel, s, color, lt, 0))
    }
    return particles
}
