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

        ctx.save()
        ctx.fillStyle = this.color
        ctx.fillRect(x - s / 2, y - s / 2, s, s)
        ctx.restore()
    }
}
