// Mirrors everything the console sees into the dev notification stack.
//
// A warning logged during a frame scrolls out of devtools before anyone looks,
// and nobody watches a console while dragging a slider. Mirroring puts it on the
// canvas instead, where it is being caused.

import { notifications, type NotificationKind } from "../ui/notifications.svelte"

type ConsoleMethod = "log" | "info" | "debug" | "warn" | "error"

/** Which console methods are mirrored, and the kind each becomes. */
const MIRRORED: Record<ConsoleMethod, NotificationKind> = {
    log: "info",
    info: "info",
    debug: "info",
    warn: "warning",
    error: "error",
}

const CONSOLE_METHODS = Object.keys(MIRRORED) as ConsoleMethod[]

/** Past this a card stops being readable, and a logged object can be megabytes. */
const MAX_CHARS = 300

/** The same message inside this window is dropped rather than repeated. */
const REPEAT_WINDOW_MS = 1000

/** How many distinct messages the repeat filter remembers at once. */
const MAX_TRACKED = 32

let installed = false
let muted = false

/** Message text to the moment it was last raised. See isRepeat. */
const recent = new Map<string, number>()

/**
 * Runs `body` with mirroring off.
 *
 * For code that reports a failure through its own channel and also wants the
 * stack in devtools - without this it raises two cards for one problem.
 */
export function withoutNotifications<T>(body: () => T): T {
    const before = muted
    muted = true

    try {
        return body()
    } finally {
        muted = before
    }
}

function describe(value: unknown): string {
    if (typeof value === "string") return value
    if (value instanceof Error) return value.message
    if (value === null) return "null"
    if (value === undefined) return "undefined"

    if (typeof value === "object") {
        // A circular structure - a GPU object, a Svelte state proxy - throws
        // here, and a logging helper that throws is worse than one that says less
        try {
            return JSON.stringify(value) ?? String(value)
        } catch {
            return String(value)
        }
    }

    return String(value)
}

/** One line from a console call's arguments, capped so a card stays readable. */
function format(args: readonly unknown[]): string {
    const text = args.map(describe).join(" ")
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text
}

/**
 * True when this message was already raised inside the window. Records it either way.
 *
 * A set rather than a single last-seen slot, because the failures that flood are
 * usually a *cycle* rather than one line: one bad frame produces three different
 * device errors in a fixed order, and comparing only against the previous message
 * lets all three through on every pass.
 */
function isRepeat(message: string): boolean {
    const now = Date.now()
    const seenAt = recent.get(message)

    // Pruned lazily rather than on a timer - a long session would otherwise keep
    // every distinct string it ever logged
    if (recent.size >= MAX_TRACKED) {
        for (const [text, at] of recent) {
            if (now - at >= REPEAT_WINDOW_MS) recent.delete(text)
        }
    }

    recent.set(message, now)
    return seenAt !== undefined && now - seenAt < REPEAT_WINDOW_MS
}

function notify(kind: NotificationKind, message: string): void {
    if (kind === "warning") notifications.dev.warn(message)
    else if (kind === "error") notifications.dev.error(message)
    else if (kind === "success") notifications.dev.success(message)
    else notifications.dev.info(message)
}

/**
 * Raises one notification, re-entrantly safe.
 *
 * The guard matters more than it looks: raising a notification can itself log,
 * and a console.error handler that reaches console.error never returns.
 */
function raise(kind: NotificationKind, args: readonly unknown[]): void {
    if (muted) return

    muted = true
    try {
        // A failure inside a render loop logs the same line sixty times a
        // second. The stack is capped at MAX_VISIBLE, but every repeat still
        // burns an id and a timer, and eight copies of one message is not a list.
        const message = format(args)
        if (message !== "" && !isRepeat(message)) notify(kind, message)
    } catch {
        // Nothing useful to do here - reporting the reporter would recurse, and
        // the original console call has already gone out
    } finally {
        muted = false
    }
}

/**
 * Starts mirroring. Returns the teardown that puts the console back.
 *
 * @returns a function that restores every patched method and detaches the
 *          window listeners. Call it on unmount; HMR reloads otherwise stack
 *          one patch on top of the last.
 */
export function installConsoleNotifications(): () => void {
    // A second install would wrap the already-wrapped methods, so one log would
    // raise two cards and the restore would put a patched function back in place
    // of the original
    if (installed) return () => {}
    installed = true

    const originals = {} as Record<ConsoleMethod, (...args: unknown[]) => void>

    for (const name of CONSOLE_METHODS) {
        const original = console[name].bind(console) as (...args: unknown[]) => void
        originals[name] = original

        console[name] = (...args: unknown[]) => {
            // First, so a throw in the mirroring can never cost a log line
            original(...args)
            raise(MIRRORED[name], args)
        }
    }

    // Anything that never reached a catch: a listener that threw, a rejected
    // promise nobody handled. These are the failures most likely to be invisible.
    const onError = (event: ErrorEvent) => raise("error", [event.message])
    const onRejection = (event: PromiseRejectionEvent) => raise("error", ["Unhandled rejection:", event.reason])

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)

    return () => {
        for (const name of CONSOLE_METHODS) console[name] = originals[name]

        window.removeEventListener("error", onError)
        window.removeEventListener("unhandledrejection", onRejection)

        installed = false
        muted = false
        recent.clear()
    }
}
