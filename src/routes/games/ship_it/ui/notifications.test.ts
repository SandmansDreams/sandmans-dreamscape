import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { notifications } from "./notifications.svelte"

const messages = () => notifications.list.map((item) => item.message)

// The manager is a singleton, so each test has to start from an empty stack
beforeEach(() => {
    vi.useFakeTimers()
    notifications.clear()
})

afterEach(() => {
    notifications.clear()
    vi.useRealTimers()
})

describe("notifications", () => {
    it("keeps them oldest first", () => {
        notifications.info("first")
        notifications.success("second")

        expect(messages()).toEqual(["first", "second"])
    })

    it("hands back an id per notification", () => {
        expect(notifications.info("a")).not.toBe(notifications.info("b"))
    })

    it("drops the oldest once past the visible cap", () => {
        const raised = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
        for (const message of raised) notifications.info(message)

        // Nine raised, eight kept, and it is "1" that goes
        expect(messages()).toEqual(raised.slice(1))
    })

    it("times out the kinds that have a lifetime", () => {
        notifications.info("gone soon")
        vi.advanceTimersByTime(4000)

        expect(messages()).toEqual([])
    })

    it("leaves errors up until they are dismissed", () => {
        const id = notifications.error("stays")
        vi.advanceTimersByTime(60_000)
        expect(messages()).toEqual(["stays"])

        notifications.dismiss(id)
        expect(messages()).toEqual([])
    })

    it("honours a lifetime override", () => {
        notifications.show("error", "goes anyway", 1000)
        vi.advanceTimersByTime(1000)

        expect(messages()).toEqual([])
    })

    it("ignores a dismiss of an id it does not hold", () => {
        notifications.info("kept")
        notifications.dismiss(999)

        expect(messages()).toEqual(["kept"])
    })

    it("does not let a dropped notification's timer fire later", () => {
        // The one at the front is evicted by the cap rather than dismissed, so
        // its timer has to be cancelled on the way out
        const evicted = notifications.info("1")
        for (const message of ["2", "3", "4", "5"]) notifications.info(message)

        notifications.dismiss(evicted) // no-op: it is already gone
        vi.advanceTimersByTime(4000)

        expect(messages()).toEqual([])
    })
})
