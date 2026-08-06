import type { SettingsSchema, SettingValues } from "../settings/settings"
import { RenderTarget } from "../render/targets"

export interface SceneContext { // Everything the harness hands a scene so it can build itself
    readonly gl2: WebGL2RenderingContext
    readonly canvas: HTMLCanvasElement
    readonly target: RenderTarget
}

/**
 * `V` is the scene's own value type, normally `ValuesOf<typeof SETTINGS>`.
 *
 * It defaults to `any` so DEV_SCENES can hold scenes with different schemas in
 * one array. Nothing is lost by that - the harness has no use for the types,
 * and each scene checks its own values where it declares them.
 */
export interface DevSceneDefinition<V = any> {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly settings: SettingsSchema
    create(context: SceneContext): DevSceneInstance<V>
}

export interface DevSceneInstance<V = any> {
    update(dt: number, settings: V): void
    render(): void
    present?(target: RenderTarget): void // Override the target
    resize?(width: number, height: number): void
    dispose(): void
}

/*~~~ Get and import all dev scenes from the folder ~~~*/
const modules = import.meta.glob<{ default?: DevSceneDefinition }>(
    "./scenes/*.ts",
    { eager: true }
)

export const DEV_SCENES: DevSceneDefinition[] = Object.values(modules)
    .map((module) => module.default)
    .filter((scene): scene is DevSceneDefinition => scene != null)
    .sort((a, b) => a.name.localeCompare(b.name))

export class DevHarness {
    readonly target: RenderTarget
    private instance: DevSceneInstance | null = null
    private settings: SettingValues = {}

    private isRunning = false
    private lastTime = 0
    fps = 0

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly gl2: WebGL2RenderingContext,
        private readonly present: (target: RenderTarget) => void,
        private readonly renderScale = 1,
    ) {
        this.syncCanvasSize()
        this.target = new RenderTarget(gl2, ...this.targetSize())
    }

    load(definition: DevSceneDefinition, values: SettingValues) {
        this.instance?.dispose()
        this.settings = values
        this.instance = definition.create({
            gl2: this.gl2,
            canvas: this.canvas,
            target: this.target,
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
            if (this.syncCanvasSize()) {
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
            console.error("DevHarness: scene threw, loop stopped.", error)
            return
        }

        requestAnimationFrame(this.frame)
    }
}