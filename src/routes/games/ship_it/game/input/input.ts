import { loadStore, saveStore } from "../../settings/storage"
import { specOf, type ActionId, type InputContext, ACTION_IDS, isActionId } from "./actions"

/*~~~ DECLARATIONS ~~~*/
const STORAGE_KEY = "ship_it-bindings"

export interface InputOptions {
    canvas?: HTMLCanvasElement
    bindings?: Bindings
    keyboard?: KeyboardInput
    pointer?: PointerInput
}

const pointerTypeToNumber = {
    "left": 0,
    "middle": 1,
    "right": 2
}

type ButtonType = 'left' | 'middle' | 'right'

/** One action bound to the same code as another that could fire at the same moment. */
export interface BindingConflict {
    code: string
    actions: ActionId[]
}

/** Only overrides are stored, keyed by action. */
type StoredBindings = Partial<Record<ActionId, string[]>>


/*~~~ HELPERS ~~~*/
export function isTyping(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null
    if (!element) return false
    if (element.isContentEditable) return true

    return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
}

/** Reads stored overrides, keeping only what still means something. */
export function readBindings(data: unknown): Bindings {
    const bindings = new Bindings()
    if (data == null || typeof data !== "object") return bindings

    const bag = data as Record<string, unknown>

    for (const [action, codes] of Object.entries(bag)) {
        if (!isActionId(action)) continue
        if (!Array.isArray(codes)) continue

        // A code is a physical key name, so anything that is not a non-empty
        // string cannot match an event and is not worth storing
        const clean = codes.filter((code): code is string => typeof code === "string" && code !== "")
        if (clean.length === 0) continue

        bindings.rebind(action, clean)
    }

    return bindings
}

export function loadBindings(): Bindings {
    return readBindings(loadStore(STORAGE_KEY))
}


/*~~~ CLASSES ~~~*/
/** A handler for all inputs (pointers and keyboard) as well as keybind mapping */
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

    /** Which scene's actions are live */
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

    /** True while any key bound to this action is down. */
    held(action: ActionId): boolean {
        if (this.wantsCtrl(action) !== this.keys.ctrl) return false
        return this.codes(action).some((code) => this.keys.isDown(code))
    }

    /** Went down since the last endFrame(). Auto-repeat does not count. */
    pressed(action: ActionId): boolean {
        const wantsCtrl = this.wantsCtrl(action)

        return this.codes(action).some(
            (code) => this.keys.pressed(code) && this.keys.pressedWithCtrl(code) === wantsCtrl,
        )
    }

    /** Came up since the last endFrame(). */
    released(action: ActionId): boolean {
        return this.codes(action).some((code) => this.keys.released(code))
    }

    /** -1, 0 or 1 from a pair of actions, so movement reads as one number. */
    axis(negative: ActionId, positive: ActionId): number {
        return (this.held(positive) ? 1 : 0) - (this.held(negative) ? 1 : 0)
    }

    /** Calls back the moment a global action is pressed. Returns an unsubscribe. */
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

    /** Whether this action asks for a command modifier. */
    private wantsCtrl(action: ActionId): boolean {
        return specOf(action).mods?.includes("ctrl") ?? false
    }
    
    /** The codes for an action, or none when its context is not live. */
    private codes(action: ActionId): readonly string[] {
        const context = specOf(action).context
        if (context === "global" || context === this.sceneContext) {
            return this.bindings.codesFor(action)
        }

        if (!this.warned.has(action)) {
            this.warned.add(action)
            console.warn(`InputService: "${action}" belongs to the "${context}" context, which is not active (current: ${this.sceneContext ?? "none"}). It will never fire.`)
        }

        return []
    }
}

/** Mouse and pen state for one canvas, polled rather than pushed. */
export class PointerInput {
    /** Position in DRAWING-BUFFER pixels, which is what Camera.screenToWorld wants. */
    x = 0
    y = 0

    /** Movement since the last endFrame(), in drawing-buffer pixels. */
    deltaX = 0
    deltaY = 0

    /** Wheel accumulated since the last endFrame(). Positive is scrolling down. */
    wheel = 0

    /** True while the pointer is over the canvas. */
    over = false

    private readonly canvas: HTMLCanvasElement
    private readonly held = new Set<number>()
    private readonly downEdges = new Set<number>()
    private readonly upEdges = new Set<number>()
    private readonly detach: (() => void)[] = []

    // The first event has no previous position to measure from, so it would
    // otherwise report a delta of the entire distance from the origin
    private seen = false

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas

        const on = <K extends keyof HTMLElementEventMap>(
            type: K,
            handler: (event: HTMLElementEventMap[K]) => void,
            options?: AddEventListenerOptions,
        ) => {
            canvas.addEventListener(type, handler as EventListener, options)
            this.detach.push(() => canvas.removeEventListener(type, handler as EventListener, options))
        }

        on("pointerdown", (event) => {
            this.track(event)
            this.held.add(event.button)
            this.downEdges.add(event.button)

            // Capture, so a drag that wanders off the canvas keeps reporting.
            // Without it, releasing outside leaves the button stuck down forever.
            canvas.setPointerCapture(event.pointerId)
        })

        on("pointermove", (event) => {
            // A move on the canvas is itself proof the pointer is on it. Relying on
            // pointerenter alone leaves `over` stuck false whenever that event was
            // missed - a pointer already inside the canvas when the scene loaded
            // never sends one, and picking silently does nothing forever after
            this.over = true
            this.track(event)
        })

        on("pointerup", (event) => {
            this.track(event)
            this.held.delete(event.button)
            this.upEdges.add(event.button)
            canvas.releasePointerCapture(event.pointerId)
        })

        // A cancelled pointer never sends an up, so clear everything or the next
        // frame still believes a button is held
        on("pointercancel", () => this.held.clear())

        on("pointerenter", () => { this.over = true })
        on("pointerleave", () => { this.over = false })

        on("wheel", (event) => {
            // Otherwise the page scrolls, or the browser zooms, instead of the scene
            event.preventDefault()
            this.wheel += event.deltaY
        }, { passive: false })

        // Right-drag is a pan, and a context menu in the middle of one is useless
        on("contextmenu", (event) => event.preventDefault())
    }

    /** 0 left, 1 middle, 2 right. */
    isDown(button: ButtonType = "left"): boolean {
        return this.held.has(pointerTypeToNumber[button])
    }

    /** Went down since the last endFrame(). */
    pressed(button: ButtonType = "left"): boolean {
        return this.downEdges.has(pointerTypeToNumber[button])
    }

    /** Came up since the last endFrame(). */
    released(button: ButtonType = "left"): boolean {
        return this.upEdges.has(pointerTypeToNumber[button])
    }

    /** Clears the per-frame edges and accumulators. Call at the end of update(). */
    endFrame(): void {
        this.downEdges.clear()
        this.upEdges.clear()
        this.deltaX = 0
        this.deltaY = 0
        this.wheel = 0
    }

    /** Detaches every listener. A scene that skips this leaks them on every swap. */
    destroy(): void {
        for (const off of this.detach) off()
        this.detach.length = 0
        this.held.clear()
    }

    private track(event: PointerEvent): void {
        const rect = this.canvas.getBoundingClientRect()

        // A hidden or zero-sized canvas would divide to Infinity
        if (rect.width === 0 || rect.height === 0) return

        /*
         * Pointer events are in CSS pixels; the camera works in drawing-buffer
         * pixels. Scaling by devicePixelRatio alone is wrong whenever CSS sizes
         * the canvas to something other than its buffer - the ratio between the
         * two is correct in both cases.
         */
        const x = (event.clientX - rect.left) * (this.canvas.width / rect.width)
        const y = (event.clientY - rect.top) * (this.canvas.height / rect.height)

        if (this.seen) {
            this.deltaX += x - this.x
            this.deltaY += y - this.y
        }

        this.x = x
        this.y = y
        this.seen = true
    }
}

/** Keyboard state for the whole window, polled like PointerInput. */
export class KeyboardInput {
    /** Codes whose browser default is suppressed while this input is alive. */
    readonly capture = new Set<string>()

    /** Called for each fresh press, after the typing guard and the repeat filter. */
    readonly onPress = new Set<(code: string) => void>()

    private readonly held = new Set<string>()
    private readonly downEdges = new Set<string>()
    /** Codes that went down while a command modifier was held. */
    private readonly ctrlEdges = new Set<string>()
    private readonly upEdges = new Set<string>()
    private readonly detach: (() => void)[] = []

    constructor(target: Window = window) {
        const on = <K extends keyof WindowEventMap>(
            type: K,
            handler: (event: WindowEventMap[K]) => void,
        ) => {
            target.addEventListener(type, handler as EventListener)
            this.detach.push(() => target.removeEventListener(type, handler as EventListener))
        }

        on("keydown", (event) => {
            if (isTyping(event.target)) return
            if (this.capture.has(event.code)) event.preventDefault()

            // Auto-repeat fires keydown over and over while a key is held down.
            // Letting it through makes pressed() true on frame after frame, so a
            // once-per-press action fires dozens of times from one press
            if (event.repeat) return

            // Before the code is added, so a modifier does not count itself
            if (this.ctrl) this.ctrlEdges.add(event.code)

            this.held.add(event.code)
            this.downEdges.add(event.code)

            for (const listener of this.onPress) listener(event.code)
        })

        on("keyup", (event) => {
            // Deliberately no isTyping guard: a key pressed on the canvas must come
            // back up even if focus moved into a field mid-press, or it stays held
            this.held.delete(event.code)
            this.upEdges.add(event.code)
        })

        // Alt-tabbing away while a key is held means its keyup lands somewhere else
        // and the scene believes it is still down. The keyboard's pointercancel.
        on("blur", () => this.held.clear())
    }

    /** Codes are physical: "KeyW", "Space", "ShiftLeft", "ArrowUp". */
    isDown(code: string): boolean {
        return this.held.has(code)
    }

    /**
     * True while a command modifier is down.
     *
     * Meta counts as ctrl: the same shortcut is written with command on a Mac,
     * and a player should not have to learn which one this build wanted. Either
     * side of the keyboard, since a chord is held with whichever hand is free.
     */
    get ctrl(): boolean {
        return this.held.has("ControlLeft") || this.held.has("ControlRight")
            || this.held.has("MetaLeft") || this.held.has("MetaRight")
    }

    /** Went down since the last endFrame(). Auto-repeat does not count. */
    pressed(code: string): boolean {
        return this.downEdges.has(code)
    }

    /** True when this key's press happened with a command modifier held. */
    pressedWithCtrl(code: string): boolean {
        return this.ctrlEdges.has(code)
    }

    /** Came up since the last endFrame(). */
    released(code: string): boolean {
        return this.upEdges.has(code)
    }

    /** Clears the per-frame edges. Call at the end of update(). */
    endFrame(): void {
        this.downEdges.clear()
        this.ctrlEdges.clear()
        this.upEdges.clear()
    }

    /** Detaches every listener. A scene that skips this leaks them on every swap. */
    destroy(): void {
        for (const off of this.detach) off()
        this.detach.length = 0
        this.held.clear()
    }
}

/** The live key bindings handler and mapper */
export class Bindings {
    private readonly overrides = new Map<ActionId, readonly string[]>()

    /** The codes that fire an action: the player's if they set any, ours otherwise. */
    codesFor(action: ActionId): readonly string[] {
        return this.overrides.get(action) ?? specOf(action).keys
    }

    /** True when this action has been changed from the shipped default. */
    isRebound(action: ActionId): boolean {
        return this.overrides.has(action)
    }

    /** Rebinds an action, or clears the override when given no codes. */
    rebind(action: ActionId, codes: readonly string[]): void {
        if (codes.length === 0) this.overrides.delete(action)
        else this.overrides.set(action, [...codes])
    }

    /** Puts one action back to its shipped keys. */
    reset(action: ActionId): void {
        this.overrides.delete(action)
    }

    resetAll(): void {
        this.overrides.clear()
    }

    /** Every code that currently fires anything in these contexts, with its action. */
    codeMap(contexts: readonly InputContext[]): Map<string, ActionId[]> {
        const out = new Map<string, ActionId[]>()

        for (const action of ACTION_IDS) {
            if (!contexts.includes(specOf(action).context)) continue

            for (const code of this.codesFor(action)) {
                const list = out.get(code) ?? []
                list.push(action)
                out.set(code, list)
            }
        }

        return out
    }

    /** Codes that would fire two actions at once. */
    conflictsIn(context: InputContext): BindingConflict[] {
        const contexts: InputContext[] = context === "global" ? ["global"] : ["global", context]
        const out: BindingConflict[] = []

        for (const [code, actions] of this.codeMap(contexts)) {
            if (actions.length > 1) out.push({ code, actions })
        }

        return out
    }

    /** Every clash across every context, for a panel that wants to warn up front. */
    allConflicts(): BindingConflict[] {
        const seen = new Set<string>()
        const out: BindingConflict[] = []

        for (const context of ["flight", "builder", "sprite", "viewer", "global"] as const) {
            for (const conflict of this.conflictsIn(context)) {
                // The same clash surfaces once per context that can see it, and a
                // panel should list it once
                const key = `${conflict.code}|${conflict.actions.join(",")}`
                if (seen.has(key)) continue

                seen.add(key)
                out.push(conflict)
            }
        }

        return out
    }

    toJson(): StoredBindings {
        const out: StoredBindings = {}
        for (const [action, codes] of this.overrides) out[action] = [...codes]
        return out
    }

    save(): void {
        saveStore(STORAGE_KEY, this.toJson())
    }
}