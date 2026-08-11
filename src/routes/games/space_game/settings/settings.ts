// Declarative scene settings. One schema drives both the dev UI and the value types.

import { loadStore, saveStore } from "./storage"

const SCENE_KEY = "space-game-scene"

export type SettingSpec =
    // A slider. `scale: "log"` is what makes a 100..200000 range usable - on a linear
    // track, 90% of the travel sits in the top decade and the low end is unreachable.
    | { type: "range"; label: string; default: number; min: number; max: number
        step?: number; scale?: "linear" | "log"; unit?: string }

    // Typed entry, for exact values a slider can never hit: seeds, counts, ids
    | { type: "number"; label: string; default: number
        min?: number; max?: number; step?: number; unit?: string }

    | { type: "checkbox"; label: string; default: boolean }

    // `display: "segmented"` renders buttons instead of a dropdown - better for 2-4
    // options you switch between constantly, like a draw mode
    | { type: "selection"; label: string; default: string; options: readonly string[]
        display?: "dropdown" | "segmented" }

    | { type: "text"; label: string; default: string; placeholder?: string; rows?: number }

    // "#rrggbb". Use hexToRgb() to get the floats a mesh or clear color wants.
    | { type: "color"; label: string; default: string }

    // Not a value but an event. Its stored number is a click counter: a scene
    // compares it against the last one it saw to notice a press. That keeps buttons
    // inside the same plain value bag as everything else.
    | { type: "button"; label: string }

    // Purely presentational: a heading to break a long panel into sections
    | { type: "separator"; label: string }

/** A scene's settings, keyed by name. Declaration order is panel order. */
export type SettingsSchema = Record<string, SettingSpec>

export type SettingValue = number | boolean | string

/** Untyped bag, used at the panel and runner boundary. */
export type SettingValues = Record<string, SettingValue>

/**
 * The value type a schema produces.
 *
 * Declare a schema with `as const satisfies SettingsSchema` and this gives back
 * `{ count: number, mode: "a" | "b" }` rather than `Record<string, SettingValue>`.
 * The `satisfies` is load-bearing: it shape-checks without widening the literals,
 * which is what keeps a selection's options intact so they infer into a union here.
 */
export type ValuesOf<S extends SettingsSchema> = {
    // `as never` drops the key entirely - a separator has no value to read
    [K in keyof S as S[K] extends { type: "separator" | "button" } ? never : K]:
        S[K] extends { type: "range" | "number" } ? number :
        S[K] extends { type: "checkbox" } ? boolean :
        S[K] extends { type: "selection"; options: readonly (infer O)[] } ? O :
        S[K] extends { type: "text" | "color" } ? string :
        never
}

/** The button keys of a schema: exactly the names a scene's `actions` must provide. */
export type ActionsOf<S extends SettingsSchema> = {
    [K in keyof S]: S[K] extends { type: "button" } ? K : never
}[keyof S]

export function defaultValues(schema: SettingsSchema): SettingValues {
    const values: SettingValues = {}

    for (const [key, spec] of Object.entries(schema)) {
        if (spec.type === "separator" || spec.type === "button") continue      // contributes no value
        else values[key] = spec.default
    }

    return values
}

/**
 * Checks unknown values against a schema, falling back to defaults per key.
 *
 * Stored JSON is whatever a previous build wrote, so a renamed setting or a changed
 * type would otherwise reach a scene as garbage. This is the only place values
 * arrive untrusted.
 */
export function coerceValues(schema: SettingsSchema, stored: unknown): SettingValues {
    const values = defaultValues(schema)
    if (stored == null || typeof stored !== "object") return values

    const bag = stored as Record<string, unknown>

    for (const [key, spec] of Object.entries(schema)) {
        const value = bag[key]
        if (value === undefined) continue

        switch (spec.type) {
            case "range":
                if (typeof value === "number" && Number.isFinite(value)) {
                    values[key] = Math.min(spec.max, Math.max(spec.min, value))
                }
                break
            case "checkbox":
                if (typeof value === "boolean") values[key] = value
                break
            case "selection":
                if (typeof value === "string" && spec.options.includes(value)) values[key] = value
                break
            case "text":
                if (typeof value === "string") values[key] = value
                break
            case "number":
                if (typeof value === "number" && Number.isFinite(value)) {
                    const low = spec.min ?? -Infinity
                    const high = spec.max ?? Infinity
                    values[key] = Math.min(high, Math.max(low, value))
                }
                break
            case "color":
                // Anything else would reach an <input type="color"> and be silently
                // rewritten to #000000, which looks like the scene lost its color
                if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) values[key] = value
                break
            case "button":
            case "separator":
                // A button press should not survive a reload, and a separator has
                // nothing to restore. Both keep whatever defaultValues() set.
                break
        }
    }

    return values
}

export function loadSceneId(): string | null {
    const stored = loadStore(SCENE_KEY)
    return typeof stored === "string" ? stored : null
}

export function saveSceneId(id: string): void {
    saveStore(SCENE_KEY, id)
}

// Keyed per scene, so switching away and back restores what you had set
function valuesKey(sceneId: string): string {
    return `space-game-settings:${sceneId}`
}

export function loadSceneValues(sceneId: string, schema: SettingsSchema): SettingValues {
    return coerceValues(schema, loadStore(valuesKey(sceneId)))
}

export function saveSceneValues(sceneId: string, values: SettingValues): void {
    saveStore(valuesKey(sceneId), values)
}



/** Slider position 0..1 for a value. */
export function rangeToPosition(min: number, max: number, scale: "linear" | "log" | undefined, value: number): number {
    if (scale === "log") {
        // log(0) is -Infinity and log of a negative is NaN, either of which jams the
        // slider at one end with no way back
        const low = Math.log(Math.max(min, 1e-6))
        const high = Math.log(Math.max(max, 1e-6))
        if (high === low) return 0
        return (Math.log(Math.max(value, 1e-6)) - low) / (high - low)
    }

    return max === min ? 0 : (value - min) / (max - min)
}

/** Inverse of rangeToPosition, snapped to `step` and clamped. */
export function positionToRange(
    min: number, max: number, scale: "linear" | "log" | undefined,
    position: number, step?: number,
): number {
    let value: number

    if (scale === "log") {
        const low = Math.log(Math.max(min, 1e-6))
        const high = Math.log(Math.max(max, 1e-6))
        value = Math.exp(low + (high - low) * position)
    } else {
        value = min + (max - min) * position
    }

    if (step) value = Math.round(value / step) * step
    return Math.min(max, Math.max(min, value))
}

/** "#rrggbb" or "#rgb" -> RGB floats 0..1, ready for MeshBuilder or a clear color. */
export function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace("#", "")
    const full = clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean
    const value = Number.parseInt(full, 16)

    if (!Number.isFinite(value)) return [1, 1, 1] // white rather than an invisible black
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

