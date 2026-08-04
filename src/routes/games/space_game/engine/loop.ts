import { FrameStats } from "./frameStats"

/**
 * A fixed-timestep game loop with render interpolation.
 *
 * Simulation runs at a constant rate whatever the display does, which keeps
 * physics deterministic and independent of refresh rate. Whatever time is left
 * over becomes an interpolation factor, so a 60Hz simulation still renders
 * smoothly on a 144Hz monitor.
 */

export interface LoopCallbacks {
    /** Advances the simulation exactly one fixed step. */
    simulate(): void

    /**
     * Draws a frame.
     *
     * @param alpha how far between the last two simulation steps this frame
     *        falls, 0 to 1. Interpolate positions with it.
     * @returns draw calls issued, for the stats readout.
     */
    render(alpha: number): number | void

    /** Called a few times a second when new timing numbers are ready. */
    onStats?(stats: FrameStats): void
}

export interface LoopOptions {
    simHz?: number
    /**
     * Most simulation steps to run in one frame.
     *
     * Without a cap, returning to a backgrounded tab tries to catch up on
     * every missed step at once and locks the page.
     */
    maxCatchup?: number
}

export class GameLoop {
    readonly stats = new FrameStats()
    readonly stepMs: number

    private readonly maxCatchup: number
    private frameId = 0
    private previousTime = 0
    private accumulator = 0
    private running = false

    constructor(
        private readonly callbacks: LoopCallbacks,
        options: LoopOptions = {}
    ) {
        this.stepMs = 1000 / (options.simHz ?? 60)
        this.maxCatchup = options.maxCatchup ?? 5
    }

    start() {
        if (this.running) return

        this.running = true
        this.previousTime = 0
        this.accumulator = 0
        this.frameId = requestAnimationFrame(this.tick)
    }

    stop() {
        this.running = false
        cancelAnimationFrame(this.frameId)
    }

    private tick = (now: number) => {
        this.stats.begin(now)

        if (this.previousTime === 0) this.previousTime = now
        this.accumulator += Math.min(now - this.previousTime, this.stepMs * this.maxCatchup)
        this.previousTime = now

        while (this.accumulator >= this.stepMs) {
            this.callbacks.simulate()
            this.accumulator -= this.stepMs
        }

        const drawCalls = this.callbacks.render(this.accumulator / this.stepMs) ?? 0

        if (this.stats.end(performance.now(), drawCalls)) {
            this.callbacks.onStats?.(this.stats)
        }

        this.frameId = requestAnimationFrame(this.tick)
    }
}
