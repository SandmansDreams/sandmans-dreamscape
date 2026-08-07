import defaultsFile from "./defaults.json"
import { loadStore, saveStore } from "./storage";

/** Where app-level preferences live, as opposed to a scene's own values. */
export const MAIN_SETTINGS_KEY = "space-game-settings"

const SCENE_ID_KEY = "scene.id"

// All possible types a setting could be. There is no `key` field - a schema is
// keyed by object key, which is what lets the value types be inferred below.
export type SettingSpec =
    | { type: "range";     label: string; default: number;  min: number; max: number; step?: number }
    | { type: "checkbox";  label: string; default: boolean }
    | { type: "selection"; label: string; default: string;  options: readonly string[] }
    // `rows` above 1 renders a textarea, where newlines can be typed
    | { type: "text";      label: string; default: string;  placeholder?: string; rows?: number }

/** A scene's settings, keyed by setting name. */
export type SettingsSchema = Record<string, SettingSpec>

export type SettingValue = number | boolean | string

/** An untyped bag of values, used at the harness and panel boundary. */
export type SettingValues = Record<string, SettingValue>

/**
 * The value type a schema produces.
 *
 * Declare a scene's schema with `as const satisfies SettingsSchema` and this
 * gives back `{ gap: number }` rather than `Record<string, SettingValue>`.
 * `satisfies` is the load-bearing part - it checks the shape without widening
 * the literals, which keeps a selection's options intact so they can be
 * inferred into a union here.
 */
export type ValuesOf<S extends SettingsSchema> = {
    [K in keyof S]:
        S[K] extends { type: "range" }    ? number  :
        S[K] extends { type: "checkbox" } ? boolean :
        S[K] extends { type: "text" }     ? string  :
        S[K] extends { type: "selection"; options: readonly (infer O)[] } ? O :
        never
}

export const DEFAULTS: Readonly<SettingValues> = Object.freeze({ ...(defaultsFile.values as SettingValues) })

// Default values for a given setting schema
export function defaultValues(schema: SettingsSchema): SettingValues {
    const values: SettingValues = {}
    for (const [key, spec] of Object.entries(schema)) values[key] = spec.default
    return values
}

/**
 * Reads a schema's values out of storage, falling back to the schema default
 * whenever the stored value is missing or the wrong shape.
 *
 * The type checks matter: stored JSON is whatever a previous build wrote, so a
 * renamed setting or a changed type would otherwise reach a scene as garbage.
 * This is the only place values arrive untrusted - everywhere else the schema
 * types guarantee the shape at compile time.
 */
export function loadSettings(
    storageKey: string,
    schema: SettingsSchema
): SettingValues {

    const stored = loadStore(storageKey) ?? {}

    const settings: SettingValues = {}

    for (const [key, spec] of Object.entries(schema)) {
        const value = stored[key]

        switch (spec.type) {
            case "range":
                settings[key] =
                    typeof value === "number"
                        ? value
                        : spec.default
                break

            case "checkbox":
                settings[key] =
                    typeof value === "boolean"
                        ? value
                        : spec.default
                break

            case "selection":
                settings[key] =
                    typeof value === "string" &&
                    spec.options.includes(value)
                        ? value
                        : spec.default
                break

            // Free text, so there is nothing to validate past the type - a
            // stored empty string is a legitimate value and is kept.
            case "text":
                settings[key] =
                    typeof value === "string"
                        ? value
                        : spec.default
                break
        }
    }

    return settings
}

/*~~~ App-level preferences ~~~*/

export function loadMainSettings(): SettingValues {
    return { ...DEFAULTS, ...(loadStore(MAIN_SETTINGS_KEY) ?? {}) }
}

/**
 * Writes one preference, leaving the rest of the store alone.
 *
 * Only keys that were explicitly set get persisted - defaults are merged in on
 * read instead, so changing a default later still reaches anyone who never
 * touched that setting.
 */
export function saveMainSetting(key: string, value: SettingValue): void {
    const stored = loadStore(MAIN_SETTINGS_KEY) ?? {}
    saveStore(MAIN_SETTINGS_KEY, { ...stored, [key]: value })
}

/** Id of the dev scene last open, or "" if there is nothing usable stored. */
export function loadLastSceneId(): string {
    const value = loadMainSettings()[SCENE_ID_KEY]
    return typeof value === "string" ? value : ""
}

export function saveLastSceneId(id: string): void {
    saveMainSetting(SCENE_ID_KEY, id)
}
