// The app's one input owner: devices in, named actions out

import { specOf, type ActionId, type InputContext } from "./actions"
import { Bindings, loadBindings } from "./bindings"
import { KeyboardInput, PointerInput } from "./keys"

/**
 * Everything above the devices asks here, and asks by action name.
 *
 * One instance for the life of the page rather than one per scene. Three things
 * follow from that and all three were bugs waiting to happen when scenes each
 * owned their own: `endFrame` is called in exactly one place, so an edge can
 * never stay stuck true; the pointer keeps listening across a scene swap, which
 * it has to because the canvas outlives every scene; and there is a single table
 * to ask "what is bound right now".
 *
 * No caller outside this file names a key code. That is the whole point - it is
 * what makes rebinding a change to a table rather than a sweep through six scenes.
 */
/**
 * What to build the service on top of.
 *
 * The devices are injectable so the resolution path can be tested without a
 * browser: the interesting logic is "an event on this key becomes that action in
 * this context", and that deserves a test that does not need a canvas.
 */
export interface InputOptions {
    /** The element the pointer listens on. Omitted only in tests. */
    canvas?: HTMLCanvasElement
    bindings?: Bindings
    keyboard?: KeyboardInput
    pointer?: PointerInput
}

export class InputService {
    readonly pointer: PointerInput
    readonly keys: KeyboardInput

    private bindings: Bindings
    private sceneContext: InputContext | null = null

    /** Code to actions for the live contexts, rebuilt when either could change. */
    private resolved = new Map<string, ActionId[]>()

    /** Actions already complained about, so a mistake reports once and not per frame. */
    private readonly warned = new Set<string>()

    constructor(options: InputOptions = {}) {
        this.keys = options.keyboard ?? new KeyboardInput()
        this.pointer = options.pointer ?? new PointerInput(options.canvas!)
        this.bindings = options.bindings ?? loadBindings()
        this.refresh()
    }

    /**
     * Which scene's actions are live, along`global`.
     *
     * Set by the runner on every scene load, null for a scene that reads no
     * actions. Replacing rather than stacking: there is one scene on screen, so a
     * stack could only ever be one deep or wrong.
     */
    setSceneContext(context: InputContext | null): void {
        if (context === this.sceneContext) return

        this.sceneContext = context
        this.refresh()
    }

    /** The live table, for a rebinding panel to read and write. */
    get table(): Bindings {
        return this.bindings
    }

    /** Swaps the whole table, as a panel's "reset to defaults" would. */
    setBindings(bindings: Bindings): void {
        this.bindings = bindings
        this.refresh()
    }

    /** Re-reads the table after a rebinding, so the next frame uses the new keys. */
    refresh(): void {
        const contexts: InputContext[] = this.sceneContext === null || this.sceneContext === "global"
            ? ["global"]
            : ["global", this.sceneContext]

        this.resolved = this.bindings.codeMap(contexts)

        // The browser default is suppressed for exactly the live keys that asked
        // for it. Rebuilt with the table, or a rebound arrow key would keep
        // scrolling the page while its old code kept being swallowed
        this.keys.capture.clear()
        for (const [code, actions] of this.resolved) {
            if (actions.some((action) => specOf(action).capture)) this.keys.capture.add(code)
        }
    }

    /**
     * True while any key bound to this action is down.
     *
     * Live modifier state here, unlike `pressed`: a hold is about right now, and
     * letting go of ctrl mid-hold genuinely ends a ctrl action.
     */
    held(action: ActionId): boolean {
        if (this.wantsCtrl(action) !== this.keys.ctrl) return false
        return this.codes(action).some((code) => this.keys.isDown(code))
    }

    /**
     * Went down since the last endFrame(). Auto-repeat does not count.
     *
     * Modifiers are judged from the press itself rather than from the keyboard
     * now: a chord tapped and released within one frame would otherwise be read
     * after ctrl came back up, and would never fire.
     */
    pressed(action: ActionId): boolean {
        const wantsCtrl = this.wantsCtrl(action)

        return this.codes(action).some(
            (code) => this.keys.pressed(code) && this.keys.pressedWithCtrl(code) === wantsCtrl,
        )
    }

    /**
     * Came up since the last endFrame().
     *
     * Modifiers are deliberately not checked: releasing ctrl before the letter is
     * ordinary, and an action that could never report its own release would leave
     * anything watching for it stuck holding.
     */
    released(action: ActionId): boolean {
        return this.codes(action).some((code) => this.keys.released(code))
    }

    /** -1, 0 or 1 from a pair of actions, so movement reads as one number. */
    axis(negative: ActionId, positive: ActionId): number {
        return (this.held(positive) ? 1 : 0) - (this.held(negative) ? 1 : 0)
    }

    /**
     * Calls back the moment a global action is pressed. Returns an unsubscribe.
     *
     * For callers outside the frame loop: the Svelte page cannot poll, because it
     * has no frame to poll on and the loop clears every edge before a timer would
     * see it. Global-only by design - a scene is in the loop and should poll,
     * which keeps one input read per frame rather than callbacks firing mid-update.
     */
    onGlobalPress(handler: (action: ActionId) => void): () => void {
        const listener = (code: string) => {
            for (const action of this.resolved.get(code) ?? []) {
                if (specOf(action).context === "global") handler(action)
            }
        }

        this.keys.onPress.add(listener)
        return () => this.keys.onPress.delete(listener)
    }

    /** Clears the per-frame edges on both devices. The runner's job, once a frame. */
    endFrame(): void {
        this.keys.endFrame()
        this.pointer.endFrame()
    }

    destroy(): void {
        this.keys.destroy()
        this.pointer.destroy()
    }

    /**
     * Whether this action asks for a command modifier.
     *
     * An action that names ctrl needs it down; one that names nothing needs it
     * up, which is what stops ctrl+Z from also firing whatever plain Z does.
     */
    private wantsCtrl(action: ActionId): boolean {
        return specOf(action).mods?.includes("ctrl") ?? false
    }

    /**
     * The codes for an action, or none when its context is not live.
     *
     * The guard matters more than it looks: without it a scene that declared the
     * wrong context would read another surface's keys and half work, which is far
     * harder to spot than a shortcut that does nothing. Warned once, because a
     * silent nothing is the failure and a warning per frame is a different one.
     */
    private codes(action: ActionId): readonly string[] {
        const context = specOf(action).context
        if (context === "global" || context === this.sceneContext) {
            return this.bindings.codesFor(action)
        }

        if (!this.warned.has(action)) {
            this.warned.add(action)
            console.warn(
                `InputService: "${action}" belongs to the "${context}" context, ` +
                `which is not active (current: ${this.sceneContext ?? "none"}). It will never fire.`,
            )
        }

        return []
    }
}
