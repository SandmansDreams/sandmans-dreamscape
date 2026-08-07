import type { SettingsSchema, SettingValues } from "../settings/settings"
import { RenderTarget } from "./targets"

/** Everything the runner hands a scene so it can build itself. */
export interface SceneContext {
    readonly gl2: WebGL2RenderingContext
    readonly canvas: HTMLCanvasElement
    readonly target: RenderTarget

    /**
     * Fraction of the canvas the offscreen target is rendered at. 1 is native,
     * 0.25 is quarter resolution upscaled at present time.
     *
     * Safe to call every frame - it only takes effect when the value actually
     * changes, and the resize is deferred to the start of the next frame.
     */
    setRenderScale(scale: number): void
}

/**
 * A live scene. Owns GPU resources, so disposal is mandatory.
 *
 * `V` is the scene's own value type, normally `ValuesOf<typeof SETTINGS>`. It
 * defaults to `any` so one list can hold scenes with different schemas - the
 * runner has no use for the types, and each scene checks its own values where
 * it declares them.
 */
export interface SceneInstance<V = any> {
    update(dt: number, settings: V): void
    render(): void
    present?(target: RenderTarget): void // Override how the target reaches the canvas
    resize?(width: number, height: number): void
    dispose(): void
}

/**
 * Static description of a scene. No WebGL, so it can be imported anywhere and
 * listed before a context exists.
 */
export interface SceneDefinition<V = any> {
    readonly id: string
    readonly name: string
    readonly description: string
    /** Omitted by scenes with nothing to tweak. Dev scenes always declare one. */
    readonly settings?: SettingsSchema
    create(context: SceneContext): SceneInstance<V>
}

/**
 * Owns the canvas, the render target and the frame loop, and drives whichever
 * scene is loaded. Knows nothing about dev scenes specifically - a game scene
 * runs here on exactly the same terms.
 */
export class SceneRunner {
    readonly target: RenderTarget
    private instance: SceneInstance | null = null
    private settings: SettingValues = {}

    private isRunning = false
    private lastTime = 0
    fps = 0

    private renderScale: number
    private pendingScale: number

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly gl2: WebGL2RenderingContext,
        private readonly present: (target: RenderTarget) => void,
        renderScale = 1,
    ) {
        this.renderScale = renderScale
        this.pendingScale = renderScale

        this.syncCanvasSize()
        this.target = new RenderTarget(gl2, ...this.targetSize())
    }

    /**
     * Records a new render scale, applied at the top of the next frame.
     *
     * Deferred on purpose: a scene sets this from update(), by which point the
     * target is already bound and the viewport set. Reallocating its texture
     * there would leave the viewport describing the old size for the rest of
     * the frame.
     */
    setRenderScale(scale: number) {
        this.pendingScale = Math.max(0.01, Math.min(scale, 4))
    }

    load(definition: SceneDefinition, values: SettingValues) {
        this.instance?.dispose()
        this.settings = values
        this.instance = definition.create({
            gl2: this.gl2,
            canvas: this.canvas,
            target: this.target,
            setRenderScale: (scale) => this.setRenderScale(scale),
        })
    }

    setValues(values: SettingValues) {
        this.settings = values
    }

    start() {
        if (this.isRunning) return

        this.isRunning = true
        this.lastTime = performance.now()
        requestAnimationFrame(this.frame)
    }

    stop() {this.isRunning = false}

    dispose() {
        this.stop()
        this.instance?.dispose()
        this.instance = null
    }

    /**
     * The offscreen target's size. Only this scales by renderScale - the canvas
     * itself stays at full device resolution, so a low render scale gives
     * fixed-resolution rendering upscaled at present time rather than a
     * smaller canvas.
     */
    private targetSize(): [number, number] {
        return [
            Math.max(1, Math.round(this.canvas.width * this.renderScale)),
            Math.max(1, Math.round(this.canvas.height * this.renderScale)),
        ]
    }

    private syncCanvasSize(): boolean {
        const rect = this.canvas.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const width = Math.max(1, Math.round(rect.width * dpr))
        const height = Math.max(1, Math.round(rect.height * dpr))

        if (this.canvas.width === width && this.canvas.height === height) return false
        this.canvas.width = width
        this.canvas.height = height
        return true
    }

    private frame = (now: number) => {
        if (!this.isRunning) return

        const dt = Math.min((now - this.lastTime) / 1000, 0.1) // clamp after a tab-out
        this.lastTime = now
        this.fps += (1 / Math.max(dt, 1e-6) - this.fps) * 0.1  // smoothed

        try {
            // Both are checked before the target is bound, so the viewport that
            // bind() sets always matches the size the target actually has.
            const canvasChanged = this.syncCanvasSize()
            const scaleChanged = this.pendingScale !== this.renderScale

            if (canvasChanged || scaleChanged) {
                this.renderScale = this.pendingScale
                const [width, height] = this.targetSize()
                this.target.resize(width, height)
                this.instance?.resize?.(width, height)
            }

            this.target.bind()
            this.gl2.clearColor(0, 0, 0, 1)
            this.gl2.clear(this.gl2.COLOR_BUFFER_BIT)

            this.instance?.update(dt, this.settings)
            this.instance?.render()

            // Let the scene present itself if it wants to, otherwise use the default
            if (this.instance?.present) {
                this.instance.present(this.target)
            } else {
                this.present(this.target)
            }
        } catch (error) {
            // Without this a throwing scene just stops the loop with no message,
            // because an uncaught error in a rAF callback never reschedules
            this.isRunning = false
            console.error("SceneRunner: scene threw, loop stopped.", error)
            return
        }

        requestAnimationFrame(this.frame)
    }
}
