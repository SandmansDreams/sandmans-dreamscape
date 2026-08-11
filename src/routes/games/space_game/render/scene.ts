// The harness: owns the frame loop, swaps scenes in and out

import { Stats } from "../dev/performance"
import type { SettingsSchema, SettingValues } from "../settings/settings"
import type { Frame } from "./frame"
import type { GPU } from "./webgpu/gpu"
import { FrameLoop } from "./loop"
import { GpuTimer } from "./timing"

/** Everything the runner hands a scene so it can build itself. */
export interface SceneContext {
    readonly gpu: GPU
    readonly canvas: HTMLCanvasElement
    /** Shared with the dev panel - scenes record their own metrics here. */
    readonly stats: Stats
}

/**
 * A live scene. Owns GPU resources, so dispose() is mandatory.
 *
 * `V` defaults to `any` so one list can hold scenes with different schemas. The
 * runner has no use for the types; each scene declares its own alongside its schema.
 */
export interface SceneInstance<V = any> {
    update(dt: number, settings: V): void
    render(frame: Frame): void
    resize?(width: number, height: number): void
    readonly actions?: Record<string, () => void>
    dispose(): void
}

/** Static description. Touches no GPU, so scenes can be listed before a device exists. */
export interface SceneDefinition<V = any> {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly settings?: SettingsSchema
    create(context: SceneContext): SceneInstance<V>
}

export class SceneRunner {
    readonly stats = new Stats()
    clearColor: GPUColor = [0.05, 0.05, 0.07, 1]

    private readonly gpu: GPU
    private readonly loop = new FrameLoop()
    private readonly timer: GpuTimer

    private instance: SceneInstance | null = null
    private values: SettingValues = {}
    private width = 0
    private height = 0

    constructor(gpu: GPU) {
        this.gpu = gpu
        this.timer = new GpuTimer(gpu)
    }

    get fps(): number { return this.loop.fps }
    get budgetMs(): number { return this.loop.budgetMs }
    get gpuTimingSupported(): boolean { return this.timer.supported }

    load(definition: SceneDefinition, values: SettingValues): void {
        this.instance?.dispose()

        // Cleared before create() so a scene that throws while building cannot leave
        // an already-disposed instance in place for the next frame to render
        this.instance = null
        this.values = values

        // The outgoing scene's metrics would otherwise stay in the panel forever,
        // frozen at their last value and reading like live numbers
        this.stats.clear()

        this.instance = definition.create({
            gpu: this.gpu,
            canvas: this.gpu.canvas,
            stats: this.stats,
        })

        // Force resize() on the new scene's first frame
        this.width = 0
        this.height = 0
    }

    /** New values reach the scene next frame. Rebuilds nothing. */
    setValues(values: SettingValues): void {
        this.values = values
    }

    start(): void {
        this.loop.start((dt) => this.frame(dt))
    }

    stop(): void {
        this.loop.stop()
    }

    dispose(): void {
        this.stop()
        this.instance?.dispose()
        this.instance = null
        this.timer.destroy()
    }

    /** Runs a scene action by name. Unknown names are ignored. */
    invoke(name: string): void {
        try {
            this.instance?.actions?.[name]?.()
        } catch (error) {
            // A throwing action should not take the render loop with it - unlike frame(), there is nothing to stop, so just report and carry on
            console.error(`SceneRunner: action "${name}" threw.`, error)
        }
    }

    private frame(dt: number): void {
        const instance = this.instance
        if (!instance) return

        try {
            // Run the scene
            this.stats.begin("cpu frame")

            if (this.gpu.width !== this.width || this.gpu.height !== this.height) {
                this.width = this.gpu.width
                this.height = this.gpu.height
                instance.resize?.(this.width, this.height)
            }

            instance.update(dt, this.values)

            const frame = this.gpu.beginFrame(this.clearColor, this.timer)
            instance.render(frame)
            frame.end()

            this.stats.end("cpu frame")
            this.stats.set("draw calls", frame.calls)
            if (this.timer.lastMs !== null) this.stats.set("gpu pass", this.timer.lastMs, "ms")
        } catch (error) {
            // An uncaught throw inside a rAF callback stops the loop with no message
            // at all - the screen simply freezes. Stop deliberately and say why.
            this.stop()
            console.error("SceneRunner: scene threw, loop stopped.", error)
        }
    }
}