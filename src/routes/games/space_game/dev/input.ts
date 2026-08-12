// Pointer state for scenes that need picking, dragging or zooming

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
    isDown(button = 0): boolean {
        return this.held.has(button)
    }

    /** Went down since the last endFrame(). */
    pressed(button = 0): boolean {
        return this.downEdges.has(button)
    }

    /** Came up since the last endFrame(). */
    released(button = 0): boolean {
        return this.upEdges.has(button)
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