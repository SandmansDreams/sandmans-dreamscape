// The contract between Game and whatever it is drawing.
//
// Deliberately types only: Game owns the loop, the timer and the stats, so a
// scene has nothing to run and nothing to tear down but its own GPU resources.

import type { Stats } from "../dev/performance"
import type { Pipelines } from "../render/pipelines"
import type { Frame, Renderer } from "../render/webGPU/render"
import type { SettingsSchema } from "../settings/settings"
import type { InputContext } from "./input/actions"
import type { InputService } from "./input/input"

/** Which editing surface a scene wants alongside the canvas, if any. */
export type SceneUi = "builder" | "sprite" | "flight" | "viewer"

/** Everything Game hands a scene so it can build itself. */
export interface SceneContext {
    readonly renderer: Renderer
    /**
     * The shaders, pipelines and camera binding every scene shares.
     *
     * Borrowed, not owned: they outlive the scene and the next one is handed the
     * same objects, so a scene must never destroy anything reached through here.
     */
    readonly pipelines: Pipelines
    readonly canvas: HTMLCanvasElement
    /**
     * Keyboard and pointer, owned by Game rather than by the scene.
     *
     * A scene reads actions from it and does nothing else: Game calls endFrame
     * once a frame and owns its lifetime, so there is no way for a scene to leak
     * a listener or leave an edge stuck true.
     */
    readonly input: InputService
    /** Shared with the dev panel - scenes record their own metrics here. */
    readonly stats: Stats
    /**
     * Publishes a value for the page to read.
     *
     * Cleared on a scene swap, so the outgoing scene's data cannot linger and
     * read like the new scene's.
     */
    publish(key: string, value: unknown): void
}

/**
 * A live scene. Owns GPU resources, so dispose() is mandatory.
 *
 * `V` defaults to `any` so one list can hold scenes with different schemas. Game
 * has no use for the types; each scene declares its own alongside its schema.
 */
export interface SceneInstance<V = any> {
    update(dt: number, settings: V): void
    render(frame: Frame): void
    resize?(width: number, height: number): void
    readonly actions?: Record<string, () => void>
    /**
     * Receives a value pushed from the page - the mirror of context.publish.
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
    /** Which editing surface to show for this scene. */
    readonly ui?: SceneUi
    /**
     * Which set of actions this scene reads, if it reads any.
     *
     * Separate from `ui` on purpose: a scene can want the builder panel and a
     * different set of keys, and a scene with no panel at all can still fly.
     */
    readonly input?: InputContext
    create(context: SceneContext): SceneInstance<V>
}
