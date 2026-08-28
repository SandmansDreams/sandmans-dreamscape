/** The four kinds a notification can be. Each maps to one accent colour. */
export type NotificationKind = "info" | "success" | "warning" | "error"

export interface Notification {
    readonly id: number
    readonly kind: NotificationKind
    readonly message: string
    readonly devOnly: boolean
}

/** How long each kind stays up, in ms. 0 keeps it until something dismisses it. */
const LIFETIME_MS: Record<NotificationKind, number> = {
    info: 4000,
    success: 4000,
    warning: 6000,
    // Errors do not time out: the message you most need to read is the one most
    // likely to arrive while you are looking at the canvas rather than the corner
    error: 0,
}

const MAX_VISIBLE = 8

class NotificationManager {
    items = $state<Notification[]>([])
    timers = new Map<number, ReturnType<typeof setTimeout>>()
    nextId = 1

    devEnabled = $state(false)

    /** Oldest first. Reactive - read it straight from a template. */
    get list(): readonly Notification[] {
        return this.items
    }

    add(kind: NotificationKind, message: string, lifetimeMs: number, devOnly: boolean): number {
        const id = this.nextId++
        const all = [...this.items, { id, kind, message, devOnly }]

        for (const dropped of all.slice(0, -MAX_VISIBLE)) this.clearTimer(dropped.id)
        this.items = all.slice(-MAX_VISIBLE)

        if (lifetimeMs > 0) {
            this.timers.set(id, setTimeout(() => this.dismiss(id), lifetimeMs))
        }

        return id
    }

    show(kind: NotificationKind, message: string, lifetimeMs = LIFETIME_MS[kind]): number {
        return this.add(kind, message, lifetimeMs, false)
    }

    showIfDev(kind: NotificationKind, message: string): number | null {
        if (!this.devEnabled) return null
        return this.add(kind, message, LIFETIME_MS[kind], true)
    }

    info(message: string): number {
        return this.show("info", message)
    }

    success(message: string): number {
        return this.show("success", message)
    }

    warn(message: string): number {
        return this.show("warning", message)
    }

    error(message: string): number {
        return this.show("error", message)
    }

    readonly dev = {
        info: (message: string) => this.showIfDev("info", message),
        success: (message: string) => this.showIfDev("success", message),
        warn: (message: string) => this.showIfDev("warning", message),
        error: (message: string) => this.showIfDev("error", message),
    }

    /** Removes one by id. Unknown ids are ignored. */
    dismiss(id: number): void {
        this.clearTimer(id)
        this.items = this.items.filter((item) => item.id !== id)
    }

    /** Empties the stack. For a scene swap, where the old scene's messages are stale. */
    clear(): void {
        for (const timer of this.timers.values()) clearTimeout(timer)
        this.timers.clear()
        this.items = []
    }

    clearTimer(id: number): void {
        const timer = this.timers.get(id)
        if (timer === undefined) return

        clearTimeout(timer)
        this.timers.delete(id)
    }
}

/** One manager for the page. Import it anywhere - no props, no context. */
export const notifications = new NotificationManager()
