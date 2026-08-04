import type { InstancedBatch } from "../batch"

/**
 * The instancing performance baseline: thousands of independent squares,
 * integrated on the CPU and drawn in a single instanced call.
 *
 * Kept around as the yardstick every later renderer change is measured
 * against — at 10,000 squares this ran at roughly 1.7ms of frame work, most of
 * it the integration loop below rather than the GPU.
 */

export interface SquaresOptions {
    count?: number
    /** Half-extent of the wrapping field, in world units. */
    bound?: number
    size?: number
}

export class SquaresDemo {
    readonly count: number
    readonly bound: number
    readonly size: number

    private readonly posX: Float64Array
    private readonly posY: Float64Array
    private readonly prevX: Float64Array
    private readonly prevY: Float64Array
    private readonly velX: Float64Array
    private readonly velY: Float64Array
    private readonly rot: Float64Array
    private readonly prevRot: Float64Array
    private readonly rotVel: Float64Array
    private readonly color: Float32Array

    constructor(options: SquaresOptions = {}) {
        this.count = options.count ?? 10000
        this.bound = options.bound ?? 2000
        this.size = options.size ?? 5

        const n = this.count
        this.posX = new Float64Array(n)
        this.posY = new Float64Array(n)
        this.prevX = new Float64Array(n)
        this.prevY = new Float64Array(n)
        this.velX = new Float64Array(n)
        this.velY = new Float64Array(n)
        this.rot = new Float64Array(n)
        this.prevRot = new Float64Array(n)
        this.rotVel = new Float64Array(n)
        this.color = new Float32Array(n * 3)

        this.seed()
    }

    private seed() {
        for (let i = 0; i < this.count; i++) {
            // prev must match pos, or the first frame interpolates from the
            // origin and every square streaks in from the middle.
            this.posX[i] = this.prevX[i] = (Math.random() * 2 - 1) * this.bound
            this.posY[i] = this.prevY[i] = (Math.random() * 2 - 1) * this.bound

            this.velX[i] = (Math.random() * 2 - 1) * 1.5
            this.velY[i] = (Math.random() * 2 - 1) * 1.5

            this.rot[i] = this.prevRot[i] = Math.random() * Math.PI * 2
            this.rotVel[i] = (Math.random() * 2 - 1) * 0.05

            // Floored at 0.3 so nothing comes out near-black against the backdrop.
            this.color[i * 3 + 0] = 0.3 + Math.random() * 0.7
            this.color[i * 3 + 1] = 0.3 + Math.random() * 0.7
            this.color[i * 3 + 2] = 0.3 + Math.random() * 0.7
        }
    }

    simulate() {
        const bound = this.bound
        const span = bound * 2

        for (let i = 0; i < this.count; i++) {
            this.prevX[i] = this.posX[i]
            this.prevY[i] = this.posY[i]
            this.prevRot[i] = this.rot[i]

            this.posX[i] += this.velX[i]
            this.posY[i] += this.velY[i]
            this.rot[i] += this.rotVel[i]

            // Wrap prev alongside pos, or interpolation draws a streak across
            // the whole world on the frame something wraps.
            if (this.posX[i] > bound) { this.posX[i] -= span; this.prevX[i] -= span }
            if (this.posX[i] < -bound) { this.posX[i] += span; this.prevX[i] += span }
            if (this.posY[i] > bound) { this.posY[i] -= span; this.prevY[i] -= span }
            if (this.posY[i] < -bound) { this.posY[i] += span; this.prevY[i] += span }
        }
    }

    /** Feeds interpolated instances into a batch. Caller does begin/draw. */
    submit(batch: InstancedBatch, alpha: number) {
        for (let i = 0; i < this.count; i++) {
            batch.add(
                this.prevX[i] + (this.posX[i] - this.prevX[i]) * alpha,
                this.prevY[i] + (this.posY[i] - this.prevY[i]) * alpha,
                this.prevRot[i] + (this.rot[i] - this.prevRot[i]) * alpha,
                this.size,
                this.color[i * 3], this.color[i * 3 + 1], this.color[i * 3 + 2]
            )
        }
    }
}
