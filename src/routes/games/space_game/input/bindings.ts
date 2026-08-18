// Which keys currently fire which action, and what the player changed

import { loadStore, saveStore } from "../settings/storage"
import {
    ACTION_IDS,
    isActionId,
    specOf,
    type ActionId,
    type InputContext,
} from "./actions"

const STORAGE_KEY = "space-game-bindings"

/** One action bound to the same code as another that could fire at the same moment. */
export interface BindingConflict {
    code: string
    actions: ActionId[]
}

/**
 * Only overrides are stored, keyed by action.
 *
 * Storing the whole table would freeze today's defaults into every player's
 * browser: change a default later and nobody who has ever pressed a key would
 * see it. An override is the player's decision, and a default is ours to keep
 * improving.
 */
type StoredBindings = Partial<Record<ActionId, string[]>>

/**
 * The live key table.
 *
 * Read through `codesFor` rather than by reaching into the map: an action with no
 * override answers with its default, and no caller should have to know which of
 * the two it got.
 */
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

    /**
     * Rebinds an action, or clears the override when given no codes.
     *
     * Clearing rather than storing an empty list is deliberate: an action bound to
     * nothing is indistinguishable from an action nobody has touched, and the
     * default is the more useful of the two readings.
     */
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

    /**
     * Every code that currently fires anything in these contexts, with its action.
     *
     * The map InputService resolves through, built once per context change rather
     * than scanned per key per frame.
     */
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

    /**
     * Codes that would fire two actions at once.
     *
     * Checked against `global` as well as the context itself, because global
     * actions are live in every context - a builder shortcut on the backquote key
     * really would collide, while the same key in two scene contexts never can.
     *
     * Reported rather than prevented: a rebinding panel should be able to show a
     * clash and let the player decide, and refusing the write silently is how a
     * settings screen ends up feeling broken.
     */
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

/**
 * Reads stored overrides, keeping only what still means something.
 *
 * Anything unrecognised is dropped rather than trusted: the stored JSON is
 * whatever some earlier build wrote, and an action that has since been renamed
 * would otherwise sit in the table forever binding a key to nothing. The failure
 * this exists to prevent is worse than a lost override - it is a player whose
 * thrust key does nothing and who has no way to find out why.
 */
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
