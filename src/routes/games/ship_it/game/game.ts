// The whole live game: device, input, loop, stats, settings, and whatever is
// currently being drawn. One create, one destroy, so the page has exactly two
// calls to get right.

import { withoutNotifications } from "../dev/consoleNotifications"
import { Stats } from "../dev/performance"
import { Color } from "../render/color"
import { Pipelines } from "../render/pipelines"
import { FrameLoop, GPUTimer, Renderer } from "../render/webGPU/render"
import {
    loadSceneValues,
    saveSceneId,
    saveSceneValues,
    type SettingValues,
} from "../settings/settings"
import { notifications } from "../ui/notifications.svelte"
import { InputService } from "./input/input"
import type { SceneDefinition, SceneInstance } from "./scene"

/** How long a settings change waits before it reaches storage. */
const SAVE_DEBOUNCE_MS = 400

export class Game {
    readonly renderer: Renderer
    /** Shared shaders and pipelines, built once for the device and lent to scenes. */
    readonly pipelines: Pipelines
    readonly input: InputService
    readonly stats = new Stats()

    clearColor = Color.fromHex("#0d1117")

    /**
     * Where a failed frame goes.
     *
     * A callback rather than a notifications import at the throw site: the page
     * decides what a failure looks like, and Game stays testable without a UI.
     */
    onError: ((error: Error) => void) | null = null

    private readonly loop = new FrameLoop()
    private readonly timer: GPUTimer

    /** The last value published under each key, for anything reading on a ticker. */
    private readonly channel = new Map<string, unknown>()
    private listener: ((key: string, value: unknown) => void) | null = null

    private definition: SceneDefinition | null = null
    private instance: SceneInstance | null = null
    private values: SettingValues = {}
    private saveTimer: ReturnType<typeof setTimeout> | undefined

    // Zeroed on every load, which is what forces resize() on a scene's first frame
    private width = 0
    private height = 0

    private constructor(renderer: Renderer, input: InputService) {
        this.renderer = renderer
        this.input = input
        this.pipelines = Pipelines.create(renderer)
        this.timer = new GPUTimer(renderer)

        notifications.dev.success("Game created")
        if (!this.gpuTimingSupported) notifications.dev.warn("timestamp-query unavailable — no GPU timing")
    }

    static async create(canvas: HTMLCanvasElement): Promise<Game> {
        // The input service is built here rather than by the page so Game is the
        // single thing with a lifetime: one create, one destroy, and no way to
        // leak a listener by forgetting the other half of a pair
        const renderer = await Renderer.create(canvas)
        return new Game(renderer, new InputService({ canvas }))
    }

    get fps(): number {
        return this.loop.fps
    }

    /** Estimated display frame budget in ms, for colouring a stat against it. */
    get budgetMs(): number {
        return this.loop.budgetMs
    }

    get gpuTimingSupported(): boolean {
        return this.timer.supported
    }

    /** The definition currently loaded, or null before the first load(). */
    get scene(): SceneDefinition | null {
        return this.definition
    }

    /** The live settings bag. Replace it through setValues, never in place. */
    get settings(): SettingValues {
        return this.values
    }

    /** The last value a scene published under a key, or undefined. */
    published(key: string): unknown {
        return this.channel.get(key)
    }

    /**
     * Called the moment a scene publishes, instead of waiting for the next poll.
     *
     * For state the UI mirrors live: a swatch that lagged its own picker by a
     * fifth of a second reads as broken. One listener, because there is one page.
     */
    onPublish(listener: (key: string, value: unknown) => void): void {
        this.listener = listener
    }

    /**
     * Swaps in a scene, restoring the settings it was last left with.
     *
     * Rebuilds every GPU resource the outgoing scene owned, so this is the
     * expensive call - `setValues` is the cheap one.
     */
    load(definition: SceneDefinition): void {
        this.instance?.dispose()

        // Cleared before create() so a scene that throws while building cannot
        // leave an already-disposed instance in place for the next frame
        this.instance = null
        this.definition = definition

        this.values = loadSceneValues(definition.id, definition.settings ?? {})
        saveSceneId(definition.id)

        // The outgoing scene's metrics would otherwise stay in the panel forever,
        // frozen at their last value and reading like live numbers
        this.stats.clear()
        this.channel.clear()

        // Before create(), so a scene reading an action in its constructor reads
        // the right context. Null for a scene that binds nothing, which is what
        // stops the outgoing scene's keys staying live under the incoming one.
        this.input.setSceneContext(definition.input ?? null)

        try {
            this.instance = definition.create({
                renderer: this.renderer,
                pipelines: this.pipelines,
                canvas: this.renderer.canvas,
                input: this.input,
                stats: this.stats,
                publish: (key, value) => {
                    this.channel.set(key, value)
                    this.listener?.(key, value)
                },
            })
        } catch (error) {
            this.report(`scene "${definition.id}" failed to build`, error)
            return
        }

        this.width = 0
        this.height = 0
        notifications.dev.info(`Scene loaded: ${definition.name}`)
    }

    /**
     * New values reach the scene next frame and storage shortly after.
     *
     * Rebuilds nothing - this is what a slider drag calls, sixty times a second.
     */
    setValues(values: SettingValues): void {
        this.values = values

        const definition = this.definition
        if (!definition) return

        // Debounced, or that same drag writes localStorage on every pointer event
        clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => saveSceneValues(definition.id, values), SAVE_DEBOUNCE_MS)
    }

    /** Pushes a value to the current scene. Ignored if it accepts none. */
    send(key: string, value: unknown): void {
        try {
            this.instance?.receive?.(key, value)
        } catch (error) {
            this.report(`receiving "${key}" threw`, error)
        }
    }

    /** Runs a scene action by name. Unknown names are ignored. */
    invoke(name: string): void {
        try {
            this.instance?.actions?.[name]?.()
        } catch (error) {
            // A throwing action should not take the loop with it - unlike frame(),
            // there is nothing to stop, so report and carry on
            this.report(`action "${name}" threw`, error)
        }
    }

    start(): void {
        this.loop.start((dt) => this.frame(dt))
    }

    stop(): void {
        this.loop.stop()
    }

    destroy(): void {
        this.stop()

        // Flushed rather than dropped: a change made in the last 400ms before a
        // reload is exactly the one most likely to be wanted back
        clearTimeout(this.saveTimer)
        if (this.definition) saveSceneValues(this.definition.id, this.values)

        this.instance?.dispose()
        this.instance = null

        // Everything holding a buffer goes before the device that made it
        this.input.destroy()
        this.pipelines.destroy()
        this.timer.destroy()
        this.renderer.destroy()
    }

    private frame(dt: number): void {
        try {
            this.stats.begin("cpu frame")

            const instance = this.instance
            if (instance) {
                if (this.renderer.width !== this.width || this.renderer.height !== this.height) {
                    this.width = this.renderer.width
                    this.height = this.renderer.height
                    instance.resize?.(this.width, this.height)
                }

                instance.update(dt, this.values)
            }

            // One call for every scene, right after the only thing that reads
            // input. Scenes used to each own this, and one that forgot it left
            // every key looking held forever.
            this.input.endFrame()

            // Outside the instance check: with no scene loaded the pass still
            // runs, so the canvas clears and a live loop looks live
            const frame = this.renderer.beginFrame(this.clearColor.gpu, this.timer)
            instance?.render(frame)
            frame.end()

            this.stats.end("cpu frame")
            this.stats.set("draw calls", frame.calls)

            // Lags two or three frames behind, because that is how long the
            // readback takes - fine for a panel, misleading if you gate logic on it
            if (this.timer.lastMs !== null) this.stats.set("gpu pass", this.timer.lastMs, "ms")
        } catch (error) {
            // An uncaught throw inside a rAF callback stops the loop with no
            // message at all - the screen simply freezes. Stop deliberately.
            this.stop()
            this.report("scene threw, loop stopped", error)
        }
    }

    /** The one place a failure becomes an Error, a log line and a callback. */
    private report(context: string, error: unknown): void {
        const wrapped = error instanceof Error ? error : new Error(String(error))

        // The console keeps the stack, which a notification cannot show; onError
        // is what reaches the player. Muted so the two do not become two cards.
        withoutNotifications(() => console.error(`Game: ${context}.`, wrapped))
        this.onError?.(wrapped)
    }
}
