export interface InputState {
    forward: boolean,
    left: boolean,
    backward: boolean,
    right: boolean,
    space: boolean,
}

export class Vector2 {
    constructor(
        public x = 0,
        public y = 0
    ) {}

    add(other: Vector2) {
        this.x += other.x
        this.y += other.y
    }

    multiply(scalar: number) {
        this.x *= scalar
        this.y *= scalar
    }

    clone() {
        return new Vector2(this.x, this.y)
    }

    static fromAngle(angle: number) {
        return new Vector2(
            Math.cos(angle),
            Math.sin(angle)
        )
    }

    getSpeed() {
        return Math.hypot(this.x, this.y)
    }
}

export abstract class Entity {
    position: Vector2 = new Vector2(0, 0)
    velocity: Vector2 = new Vector2(0, 0)
    rotation: number = 0

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
        camera: Camera
    ): void
}

export class Player extends Entity {
    thrust: number
    drag: number

    rotationVelocity: number = 0
    rotationThrust: number
    rotationDrag: number

    // The player is the only entity that cares about keyboard input.
    // Rather than smuggling it through `update`, it holds a reference
    // to the shared InputState and reads it during its own update.
    private input: InputState = { forward: false, left: false, backward: false, right: false, space: false }

    constructor(
        position: Vector2,
        velocity: Vector2,
        rotation: number,
    ) {
        super(position, velocity, rotation)
        this.thrust = 0.1
        this.drag = 0.9999
        this.rotationThrust = 0.001
        this.rotationDrag = 0.99
    }

    // Call this once with the game's InputState object (it's mutated in
    // place by the key handlers, so you don't need to call it every frame).
    setInput(input: InputState) {
        this.input = input
    }

    update(delta: number) {
        const input = this.input
 
        if (input.left) {
            this.rotationVelocity -= this.rotationThrust * delta
        }
 
        if (input.right) {
            this.rotationVelocity += this.rotationThrust * delta
        }

        if (input.space) {
            this.velocity.multiply(0.994)
        }
 
        this.rotationVelocity *= this.rotationDrag
 
        this.rotation += this.rotationVelocity * delta
 
        if (input.forward) {
            const thrust = Vector2.fromAngle(this.rotation)
            thrust.multiply(this.thrust * delta)
            this.velocity.add(thrust)
        }

        if (input.backward) {
            const thrust = Vector2.fromAngle(this.rotation + Math.PI)
            thrust.multiply(this.thrust * delta)
            this.velocity.add(thrust)
        }
 
        this.velocity.multiply(this.drag)
 
        const movement = this.velocity.clone()
        movement.multiply(delta)
 
        this.position.add(movement)
    }

    draw(
        ctx: CanvasRenderingContext2D,
        camera: Camera
    ) {
        const x =
            this.position.x
            - camera.position.x
            + ctx.canvas.clientWidth / 2

        const y =
            this.position.y
            - camera.position.y
            + ctx.canvas.clientHeight / 2

        ctx.save()

        ctx.translate(x, y)
        ctx.rotate(this.rotation)

        ctx.beginPath()
        ctx.moveTo(18, 0)
        ctx.lineTo(-12, -10)
        ctx.lineTo(-6, 0)
        ctx.lineTo(-12, 10)
        ctx.closePath()

        ctx.fillStyle = "red"
        ctx.fill()

        ctx.restore()

        this.drawStats(ctx, x, y)
    }

    private drawStats(ctx: CanvasRenderingContext2D, screenX: number, screenY: number) {
        const speed = this.velocity.getSpeed()
 
        // Direction as a compass-style degree reading, 0-360
        const directionDeg = ((this.rotation * 180 / Math.PI) % 360 + 360) % 360
 
        const lines = [
            `speed: ${speed.toFixed(2)}`,
            `dir: ${directionDeg.toFixed(1)}°`,
            `pos: (${Math.round(this.position.x)}, ${Math.round(this.position.y)})`
        ]
 
        ctx.save()
 
        // Drawn unrotated and after ctx.restore() above, so the text
        // stays upright regardless of which way the ship is facing.
        ctx.font = "12px monospace"
        ctx.fillStyle = "rgba(0, 221, 255, 0.8)"
        ctx.textBaseline = "top"
 
        const offsetX = 24
        const lineHeight = 14
 
        lines.forEach((line, i) => {
            ctx.fillText(line, screenX + offsetX, screenY - lineHeight + i * lineHeight)
        })
 
        ctx.restore()
    }
}

export class Camera {
    position: Vector2 = new Vector2(0, 0)
    drift: number = 0.07
    maxDist: number = 150

    follow(target: Entity) {
        const dx = target.position.x - this.position.x
        const dy = target.position.y - this.position.y

        const distance = Math.hypot(dx, dy)

        const t = Math.max(distance / this.maxDist, 1)

        const drift = this.drift * t

        this.position.x += dx * drift
        this.position.y += dy * drift
    }
}