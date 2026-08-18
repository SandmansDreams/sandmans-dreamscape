// The harness: owns the frame loop, swaps scenes in and out

import { Stats } from "../dev/performance"
import type { InputContext } from "../input/actions"
import type { InputService } from "../input/service"
import type { SettingsSchema, SettingValues } from "../settings/settings"
import type { Frame } from "./frame"
import type { GPU } from "./webgpu/gpu"
import { FrameLoop } from "./loop"
import { GpuTimer } from "./timing"

/** Which editing surface a scene wants alongside the canvas, if any. */
export type SceneUi = "builder" | "sprite" | "flight"

/** Everything the runner hands a scene so it can build itself. */
export interface SceneContext {
    readonly gpu: GPU
    readonly canvas: HTMLCanvasElement
    /**
     * Keyboard and pointer, owned by the page rather than by the scene.
     *
     * A scene reads actions from it and does nothing else: the runner calls
     * endFrame once a frame and the page owns its lifetime, so there is no way
     * for a scene to leak a listener or leave an edge stuck true.
     */
    readonly input: InputService
    /** Shared with the dev panel - scenes record their own metrics here. */
    readonly stats: Stats
    /**
     * Publishes a value for the dev page to read on its ticker.
     *
     * Same lifetime as stats: cleared on a scene swap, so the outgoing scene's
     * data cannot linger and read like the new scene's.
     */
    publish(key: string, value: unknown): void
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
    /**
     * Receives a value pushed from the dev page - the mirror of context.publish.
     *
     * For state a panel owns that does not fit the settings bag, like the ship
     * editor's brush. Ignore keys you do not recognize.
     */
    receive?(key: string, value: unknown): void
    dispose(): void
}

/** Static description. Touches no GPU, so scenes can be listed before a device exists. */
export interface SceneDefinition<V = any> {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly settings?: SettingsSchema
    /** Show the builder panel for this scene. */
    readonly ui?: SceneUi
    /**
     * Which set of actions this scene reads, if it reads any.
     *
     * Separate from `ui` on purpose: a scene can want the builder panel and a
     * different set of keys, and a scene with no panel at all can still fly.
     * Reading an action outside the declared context warns rather than silently
     * doing nothing.
     */
    readonly input?: InputContext
    create(context: SceneContext): SceneInstance<V>
}

export class SceneRunner {
    readonly stats = new Stats()
    clearColor: GPUColor = [0.05, 0.05, 0.07, 1]

    private readonly gpu: GPU
    private readonly input: InputService
    private readonly loop = new FrameLoop()
    private readonly timer: GpuTimer
    private readonly channel = new Map<string, unknown>()
    private listener: ((key: string, value: unknown) => void) | null = null

    private instance: SceneInstance | null = null
    private values: SettingValues = {}
    private width = 0
    private height = 0

    constructor(gpu: GPU, input: InputService) {
        this.gpu = gpu
        this.input = input
        this.timer = new GpuTimer(gpu)
    }

    get fps(): number { return this.loop.fps }
    get budgetMs(): number { return this.loop.budgetMs }
    get gpuTimingSupported(): boolean { return this.timer.supported }

    /**
     * Called the moment a scene publishes, instead of waiting for the next poll.
     *
     * `published()` is still there for anything happy to read on a ticker. This
     * exists for state the UI mirrors live: a swatch that lagged its own picker
     * by a fifth of a second reads as broken.
     *
     * One listener, because there is one dev page. A second call replaces the first.
     */
    onPublish(listener: (key: string, value: unknown) => void): void {
        this.listener = listener
    }

    load(definition: SceneDefinition, values: SettingValues): void {
        this.instance?.dispose()

        // Cleared before create() so a scene that throws while building cannot leave
        // an already-disposed instance in place for the next frame to render
        this.instance = null
        this.values = values

        // The outgoing scene's metrics would otherwise stay in the panel forever,
        // frozen at their last value and reading like live numbers
        this.stats.clear()
        this.channel.clear()

        // Before create(), so a scene reading an action in its constructor reads the
        // right context. Null for a scene that binds nothing, which is what stops
        // the outgoing scene's keys staying live under the incoming one.
        this.input.setSceneContext(definition.input ?? null)

        this.instance = definition.create({
            gpu: this.gpu,
            canvas: this.gpu.canvas,
            input: this.input,
            stats: this.stats,
            publish: (key, value) => {
                this.channel.set(key, value)
                this.listener?.(key, value)
            },
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

    /** Pushes a value to the current scene. Ignored if it does not accept any. */
    send(key: string, value: unknown): void {
        try {
            this.instance?.receive?.(key, value)
        } catch (error) {
            console.error(`SceneRunner: receiving "${key}" threw.`, error)
        }
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

            // One call for every scene, right after the only thing that reads input.
            // Scenes used to each own this, and a scene that forgot it left every
            // key looking held forever.
            this.input.endFrame()

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