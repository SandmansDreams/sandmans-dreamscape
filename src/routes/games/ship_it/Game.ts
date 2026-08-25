import { Stats } from "./dev/performance"
import { Color } from "./render/Color"
import { GPUTimer, Renderer, type Frame } from "./render/webGPU/render"
import { notifications } from "./notifications.svelte"

/** What Game draws. Swap the implementation; Game itself never changes. */
export interface Scene {
    update(dt: number): void
    render(frame: Frame): void
    destroy(): void
}

export class Game {
    readonly renderer: Renderer
    readonly stats = new Stats()

    clearColor = Color.fromHex("#0d1117")

    onError: ((error: Error) => void) | null = null

    private readonly timer: GPUTimer
    private scene: Scene | null = null

    private handle = 0
    private last = 0
    private smoothedFps = 0
    private running = false

    get fps(): number {
        return this.smoothedFps
    }

    get gpuTimingSupported(): boolean {
        return this.renderer.gpu.features.has("timestamp-query")
    }

    private constructor(renderer: Renderer) {
        this.renderer = renderer
        this.timer = new GPUTimer(renderer)
        notifications.dev.success("Game successfully created")
    }

    static async create(canvas: HTMLCanvasElement): Promise<Game> {
        return new Game(await Renderer.create(canvas))
    }

    /** Replaces the current scene and destroys the old one. */
    setScene(scene: Scene | null): void {
        this.scene?.destroy()
        this.scene = scene

        // The outgoing scene's numbers would otherwise sit in the panel forever,
        // frozen at their last value and reading like live ones
        this.stats.clear()
    }

    start(): void {
        if (this.running) return

        this.running = true
        this.last = performance.now()
        this.handle = requestAnimationFrame(this.tick)
    }

    stop(): void {
        this.running = false
        if (this.handle !== 0) cancelAnimationFrame(this.handle)
        this.handle = 0
    }

    destroy(): void {
        this.stop()
        this.setScene(null)

        // Before the renderer: the timer holds buffers made against that device
        this.timer.destroy()
        this.renderer.destroy()
    }

    // An arrow field so rAF keeps `this` without a bind at every call site
    private tick = (now: number): void => {
        if (!this.running) return

        // Clamped: a backgrounded tab resumes with a dt of several seconds, which
        // would teleport everything the moment physics exists
        const dt = Math.min((now - this.last) / 1000, 0.1)
        this.last = now

        if (dt > 0) {
            const instant = 1 / dt
            this.smoothedFps = this.smoothedFps === 0
                ? instant
                : this.smoothedFps + (instant - this.smoothedFps) * 0.1
        }

        try {
            this.frame(dt)
        } catch (error) {
            // An uncaught throw inside a rAF callback stops the loop with no
            // message at all - the screen simply freezes. Stop deliberately and
            // say why, rather than leaving a frozen canvas and a silent console.
            this.stop()
            this.onError?.(error instanceof Error ? error : new Error(String(error)))
            return
        }

        this.handle = requestAnimationFrame(this.tick)
    }

    private frame(dt: number): void {
        this.stats.begin("cpu frame")
        this.scene?.update(dt)

        const frame = this.renderer.beginFrame(this.clearColor.gpu, this.timer)
        this.scene?.render(frame)
        frame.end()

        this.stats.end("cpu frame")
        this.stats.set("draw calls", frame.calls)

        // Lags two or three frames behind, because that is how long the readback
        // takes - fine for a panel, misleading if you ever gate logic on it
        if (this.timer.lastMs !== null) this.stats.set("gpu pass", this.timer.lastMs, "ms")
    }
}

