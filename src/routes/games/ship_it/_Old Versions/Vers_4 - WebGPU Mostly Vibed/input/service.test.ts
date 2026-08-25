import { describe, expect, it } from "vitest"
import { readBindings } from "./bindings"
import { KeyboardInput, PointerInput } from "./keys"
import { InputService } from "./service"

/**
 * A stand-in for `window` that hands back the handlers it was given.
 *
 * KeyboardInput takes its target, so the whole path from a keydown to an action
 * can be exercised without a browser - which is the point, because the browser is
 * exactly where this is awkward to check: a hidden tab throttles its frame loop to
 * nothing, and a held key proves nothing if no frame reads it.
 */
function fakeWindow() {
    const handlers = new Map<string, ((event: unknown) => void)[]>()

    return {
        target: {
            addEventListener(type: string, handler: (event: unknown) => void) {
                const list = handlers.get(type) ?? []
                list.push(handler)
                handlers.set(type, list)
            },
            removeEventListener(type: string, handler: (event: unknown) => void) {
                const list = handlers.get(type) ?? []
                handlers.set(type, list.filter((h) => h !== handler))
            },
        } as unknown as Window,

        fire(type: string, event: Record<string, unknown>) {
            // preventDefault included because a captured key calls it, and until
            // something pressed one no test here ever needed it to exist
            const base = { repeat: false, preventDefault() {} }
            for (const handler of handlers.get(type) ?? []) handler({ ...base, ...event })
        },
    }
}

/** The service with a real keyboard on a fake window, and no pointer worth having. */
function harness(stored: unknown = null) {
    const win = fakeWindow()
    const keyboard = new KeyboardInput(win.target)

    // Only the lifecycle calls the service makes on it; nothing here reads a
    // pointer, and a real one would want a canvas
    const pointer = { endFrame() {}, destroy() {} } as unknown as PointerInput

    const input = new InputService({
        keyboard,
        pointer,
        bindings: readBindings(stored),
    })

    return {
        input,
        press: (code: string) => win.fire("keydown", { code }),
        release: (code: string) => win.fire("keyup", { code }),
        blur: () => win.fire("blur", {}),
    }
}

describe("resolving a key to an action", () => {
    it("reports an action held while its key is down", () => {
        const { input, press, release } = harness()
        input.setSceneContext("flight")

        expect(input.held("flight.thrustForward")).toBe(false)

        press("KeyW")
        expect(input.held("flight.thrustForward")).toBe(true)
        expect(input.pressed("flight.thrustForward")).toBe(true)

        // The edge goes at the end of the frame; the hold does not
        input.endFrame()
        expect(input.pressed("flight.thrustForward")).toBe(false)
        expect(input.held("flight.thrustForward")).toBe(true)

        release("KeyW")
        expect(input.held("flight.thrustForward")).toBe(false)
        expect(input.released("flight.thrustForward")).toBe(true)
    })

    it("turns a pair of actions into an axis", () => {
        const { input, press, release } = harness()
        input.setSceneContext("flight")

        expect(input.axis("flight.thrustForward", "flight.thrustBack")).toBe(0)

        // Forward is the negative end, because the ship's north is negative y
        press("KeyW")
        expect(input.axis("flight.thrustForward", "flight.thrustBack")).toBe(-1)

        press("KeyS")
        expect(input.axis("flight.thrustForward", "flight.thrustBack")).toBe(0)

        release("KeyW")
        expect(input.axis("flight.thrustForward", "flight.thrustBack")).toBe(1)
    })

    it("ignores a key belonging to a context that is not live", () => {
        const { input, press } = harness()
        input.setSceneContext("builder")

        press("KeyW")
        // W is bound in flight, and the builder is what is on screen
        expect(input.held("flight.thrustForward")).toBe(false)
    })

    it("keeps global actions live in every context", () => {
        const { input, press } = harness()
        input.setSceneContext("flight")

        press("Backquote")
        expect(input.pressed("global.devPanel")).toBe(true)
    })

    it("hands the same key to whichever context is live", () => {
        // R rotates in the builder and in the sprite editor. Switching scenes is
        // the whole of what decides which one a press means.
        const { input, press } = harness()

        input.setSceneContext("builder")
        press("KeyR")
        expect(input.held("builder.rotate")).toBe(true)
        expect(input.held("sprite.rotate")).toBe(false)

        input.setSceneContext("sprite")
        expect(input.held("sprite.rotate")).toBe(true)
        expect(input.held("builder.rotate")).toBe(false)
    })

    it("follows a rebinding without a rebuild", () => {
        const { input, press } = harness({ "flight.thrustForward": ["ArrowUp"] })
        input.setSceneContext("flight")

        press("KeyW")
        expect(input.held("flight.thrustForward")).toBe(false)

        press("ArrowUp")
        expect(input.held("flight.thrustForward")).toBe(true)
    })

    it("takes a rebinding applied while it is running", () => {
        const { input, press } = harness()
        input.setSceneContext("flight")

        input.table.rebind("flight.thrustForward", ["KeyI"])
        input.refresh()

        press("KeyI")
        expect(input.held("flight.thrustForward")).toBe(true)
    })
})

describe("modifiers", () => {
    it("fires a ctrl action only while ctrl is down", () => {
        const { input, press } = harness()
        input.setSceneContext("builder")

        press("KeyZ")
        expect(input.pressed("builder.undo")).toBe(false)

        input.endFrame()
        press("ControlLeft")
        press("KeyZ")
        expect(input.pressed("builder.undo")).toBe(true)
    })

    it("takes command as ctrl, so the Mac chord is the same chord", () => {
        const { input, press } = harness()
        input.setSceneContext("builder")

        press("MetaLeft")
        press("KeyY")
        expect(input.pressed("builder.redo")).toBe(true)
    })

    it("holds a plain action back while ctrl is down", () => {
        // The bug this pins: ctrl+Z firing undo *and* whatever plain Z does
        const { input, press, release } = harness()
        input.setSceneContext("builder")

        press("ControlLeft")
        press("KeyR")
        expect(input.pressed("builder.rotate")).toBe(false)

        input.endFrame()
        release("ControlLeft")
        release("KeyR")
        press("KeyR")
        expect(input.pressed("builder.rotate")).toBe(true)
    })

    it("fires a chord that began and ended inside one frame", () => {
        // The bug this pins: judging ctrl at poll time instead of at the press.
        // A brisk ctrl+Z is over in well under a frame at 30Hz, and reading the
        // keyboard afterwards finds ctrl already back up
        const { input, press, release } = harness()
        input.setSceneContext("builder")

        press("ControlLeft")
        press("KeyZ")
        release("KeyZ")
        release("ControlLeft")

        expect(input.pressed("builder.undo")).toBe(true)
    })

    it("still reports the release, whichever way ctrl went first", () => {
        // Letting go of ctrl before the letter is ordinary, and an action that
        // could never report its own release would leave a watcher stuck holding
        const { input, press, release } = harness()
        input.setSceneContext("builder")

        press("ControlLeft")
        press("KeyZ")
        input.endFrame()

        release("ControlLeft")
        release("KeyZ")
        expect(input.released("builder.undo")).toBe(true)
    })
})

describe("captured keys", () => {
    it("suppresses the browser default only for the live actions that asked", () => {
        const { input } = harness()

        input.setSceneContext("flight")
        // Z asks for it, W does not
        expect(input.keys.capture.has("KeyZ")).toBe(true)
        expect(input.keys.capture.has("KeyW")).toBe(false)

        input.setSceneContext("builder")
        // The arrows scroll the page, so the builder claims them; undo claims Z
        // to keep the browser's own undo out of it. R is bound and wants neither
        expect(input.keys.capture.has("ArrowUp")).toBe(true)
        expect(input.keys.capture.has("KeyZ")).toBe(true)
        expect(input.keys.capture.has("KeyR")).toBe(false)
    })

    it("moves the capture with a rebinding", () => {
        const { input } = harness({ "flight.toggleAssist": ["KeyX"] })
        input.setSceneContext("flight")

        expect(input.keys.capture.has("KeyX")).toBe(true)
        expect(input.keys.capture.has("KeyZ")).toBe(false)
    })
})

describe("losing the window", () => {
    it("drops every held key, because their keyup lands somewhere else", () => {
        // Alt-tabbing away mid-press used to leave a thruster burning forever
        const { input, press, blur } = harness()
        input.setSceneContext("flight")

        press("KeyW")
        expect(input.held("flight.thrustForward")).toBe(true)

        blur()
        expect(input.held("flight.thrustForward")).toBe(false)
    })
})

describe("global press callbacks", () => {
    it("calls back on a global action and not on a scene one", () => {
        const { input, press } = harness()
        input.setSceneContext("flight")

        const seen: string[] = []
        const off = input.onGlobalPress((action) => seen.push(action))

        press("Backquote")
        press("KeyW")
        expect(seen).toEqual(["global.devPanel"])

        off()
        press("Backquote")
        expect(seen).toEqual(["global.devPanel"])
    })
})
