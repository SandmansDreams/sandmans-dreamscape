// Raw device state, polled once per frame rather than pushed

/**
 * True when the event was meant for a text field rather than for the game.
 *
 * Exported because it is the one guard every input path needs and the one most
 * easily forgotten: three separate handlers used to restate it, and the day one
 * of them was written without it, typing a ship name rotated blocks.
 */
export function isTyping(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null
    if (!element) return false
    if (element.isContentEditable) return true

    return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
}

const pointerTypeToNumber = {
    "left": 0,
    "middle": 1,
    "right": 2
}

type ButtonType = 'left' | 'middle' | 'right'


/**
 * Mouse and pen state for one canvas, polled rather than pushed.
 *
 * Polling suits a frame loop: a scene reads what is true now instead of handling
 * callbacks that fire between frames. `pressed`/`released` are the edges since
 * the last endFrame(), which is why endFrame() must be called once per update -
 * without it a click would look held forever.
 */
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

/**
 * Keyboard state for the whole window, polled like PointerInput.
 *
 * Keyed on `event.code` - the physical key - not `event.key`. WASD on a Dvorak
 * layout is still the same four keys under the same four fingers, and `code` is
 * what says so.
 *
 * Nothing above this class should name a code: InputService maps codes to actions
 * and every caller asks for an action. This is the device, not the bindings.
 */
export class KeyboardInput {
    /**
     * Codes whose browser default is suppressed while this input is alive.
     *
     * Opt-in rather than blanket: arrows scroll the page and space scrolls it
     * further, but swallowing every key would break tab, refresh and devtools.
     * InputService fills this from the `capture` flag on the active actions.
     */
    readonly capture = new Set<string>()

    /**
     * Called for each fresh press, after the typing guard and the repeat filter.
     *
     * Polling covers everything inside the frame loop. This is for the callers
     * that are not in it - the Svelte page, which would have to sample on a timer
     * and would miss the edge, because the loop clears edges every frame.
     */
    readonly onPress = new Set<(code: string) => void>()

    private readonly held = new Set<string>()
    private readonly downEdges = new Set<string>()
    /**
     * Codes that went down while a command modifier was held.
     *
     * Recorded at the press rather than read at the poll, because the two are not
     * the same moment: a chord tapped and released inside one frame - which at
     * 30Hz is any brisk ctrl+Z - would be read with ctrl already back up, and the
     * shortcut would simply not fire.
     */
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
