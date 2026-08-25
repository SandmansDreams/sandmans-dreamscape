import { describe, expect, it } from "vitest"
import { ACTION_IDS, actionsIn, specOf } from "./actions"
import { readBindings } from "./bindings"

describe("the catalogue", () => {
    it("gives every action at least one key", () => {
        // An action with no default is one nobody can fire until they find the
        // rebinding panel, which is not a state worth shipping
        for (const action of ACTION_IDS) {
            expect(specOf(action).keys.length, action).toBeGreaterThan(0)
        }
    })

    it("ships with nothing clashing", () => {
        expect(readBindings(null).allConflicts()).toEqual([])
    })

    it("lets two scene contexts share a key", () => {
        // R rotates in both the builder and the sprite editor, and neither is a
        // clash: only one of those surfaces is ever on screen
        const bindings = readBindings(null)

        expect(bindings.codesFor("builder.rotate")).toEqual(["KeyR"])
        expect(bindings.codesFor("sprite.rotate")).toEqual(["KeyR"])
        expect(bindings.conflictsIn("builder")).toEqual([])
        expect(bindings.conflictsIn("sprite")).toEqual([])
    })

    it("groups actions by the surface they belong to", () => {
        expect(actionsIn("global")).toEqual(["global.devPanel"])
        expect(actionsIn("flight")).toContain("flight.thrustForward")
        expect(actionsIn("flight")).not.toContain("builder.rotate")
    })
})

describe("reading stored bindings", () => {
    it("falls back to the defaults with nothing stored", () => {
        const bindings = readBindings(null)

        expect(bindings.codesFor("flight.thrustForward")).toEqual(["KeyW"])
        expect(bindings.isRebound("flight.thrustForward")).toBe(false)
    })

    it("lets a stored override win", () => {
        const bindings = readBindings({ "flight.thrustForward": ["ArrowUp"] })

        expect(bindings.codesFor("flight.thrustForward")).toEqual(["ArrowUp"])
        expect(bindings.isRebound("flight.thrustForward")).toBe(true)
        // Untouched actions keep theirs
        expect(bindings.codesFor("flight.thrustBack")).toEqual(["KeyS"])
    })

    it("drops an action this build has never heard of", () => {
        // The failure being guarded: a renamed action leaves an entry that binds a
        // key to nothing, and the player's thrust key silently stops working
        const bindings = readBindings({ "flight.warpDrive": ["KeyJ"] })

        expect(bindings.toJson()).toEqual({})
    })

    it("drops entries that are not lists of codes", () => {
        const bindings = readBindings({
            "flight.turnLeft": "KeyJ",
            "flight.turnRight": [],
            "flight.strafeLeft": [""],
            "flight.strafeRight": [17],
        })

        expect(bindings.toJson()).toEqual({})
        expect(bindings.codesFor("flight.turnLeft")).toEqual(["KeyQ"])
    })

    it("survives rubbish without throwing", () => {
        expect(() => readBindings("nope")).not.toThrow()
        expect(() => readBindings(42)).not.toThrow()
        expect(readBindings([]).toJson()).toEqual({})
    })
})

describe("rebinding", () => {
    it("reports a key that would fire two actions at once", () => {
        const bindings = readBindings(null)
        bindings.rebind("builder.mirror", ["KeyR"])

        const conflicts = bindings.conflictsIn("builder")
        expect(conflicts).toHaveLength(1)
        expect(conflicts[0]!.code).toBe("KeyR")
        expect(conflicts[0]!.actions.sort()).toEqual(["builder.mirror", "builder.rotate"])
    })

    it("counts a clash with a global action, which is always live", () => {
        const bindings = readBindings(null)
        bindings.rebind("builder.rotate", ["Backquote"])

        expect(bindings.conflictsIn("builder")).toHaveLength(1)
    })

    it("takes several keys for one action", () => {
        const bindings = readBindings(null)
        bindings.rebind("flight.thrustForward", ["KeyW", "ArrowUp"])

        expect(bindings.codesFor("flight.thrustForward")).toEqual(["KeyW", "ArrowUp"])
    })

    it("treats binding nothing as clearing the override", () => {
        const bindings = readBindings({ "flight.thrustForward": ["KeyJ"] })
        bindings.rebind("flight.thrustForward", [])

        expect(bindings.isRebound("flight.thrustForward")).toBe(false)
        expect(bindings.codesFor("flight.thrustForward")).toEqual(["KeyW"])
    })

    it("puts one action back without touching the others", () => {
        const bindings = readBindings({
            "flight.thrustForward": ["KeyJ"],
            "flight.thrustBack": ["KeyK"],
        })
        bindings.reset("flight.thrustForward")

        expect(bindings.codesFor("flight.thrustForward")).toEqual(["KeyW"])
        expect(bindings.codesFor("flight.thrustBack")).toEqual(["KeyK"])
    })

    it("stores only what the player changed", () => {
        // Writing the whole table would freeze today's defaults into the browser,
        // so a later change to one would never reach anyone who had played
        const bindings = readBindings(null)
        bindings.rebind("flight.turnLeft", ["KeyJ"])

        expect(bindings.toJson()).toEqual({ "flight.turnLeft": ["KeyJ"] })
    })

    it("round trips through storage", () => {
        const first = readBindings(null)
        first.rebind("flight.toggleAssist", ["KeyX"])

        const second = readBindings(first.toJson())
        expect(second.codesFor("flight.toggleAssist")).toEqual(["KeyX"])
    })
})

describe("the code map", () => {
    it("holds only the contexts asked for", () => {
        const map = readBindings(null).codeMap(["global", "flight"])

        expect(map.get("KeyW")).toEqual(["flight.thrustForward"])
        expect(map.get("Backquote")).toEqual(["global.devPanel"])
        // The builder's R is not live while flying
        expect(map.has("KeyR")).toBe(false)
    })

    it("follows a rebinding", () => {
        const bindings = readBindings(null)
        bindings.rebind("flight.thrustForward", ["KeyI"])

        const map = bindings.codeMap(["flight"])
        expect(map.get("KeyI")).toEqual(["flight.thrustForward"])
        expect(map.has("KeyW")).toBe(false)
    })
})
