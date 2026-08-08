import { isHexColor } from "../engine/color"
import { HULLS } from "../hulls"
import { MESH_SHADERS } from "../engine/shaders"
import defaultsFile from "./defaults.json"

/**
 * Browser-local settings.
 *
 * Values live in defaults.json; this file holds what each one *means* — its
 * label, its kind, and the range it is allowed to take. Splitting them that way
 * keeps the defaults a plain readable file while still giving the settings
 * panel enough to build itself, and gives validation something to check against.
 *
 * Two decisions worth knowing:
 *
 *   - **Keys are flat, with dotted paths.** Merging, diffing and validating are
 *     then one-level loops instead of recursion; the panel groups by the prefix
 *     before the dot, so it still reads as structure.
 *
 *   - **Only the difference from the defaults is stored.** Persist the whole
 *     resolved bag and defaults.json becomes write-once — everyone stays frozen
 *     on whatever shipped the day they first loaded the page. Storing the diff
 *     means a setting you have never touched keeps tracking the file.
 */

export const SETTINGS_VERSION = 1

export const STORAGE_KEY = "space-game-settings"

export type SettingValue = number | string | boolean
export type Settings = Record<string, SettingValue>

export type SettingSpec =
    | { kind: "number", label: string, min: number, max: number, step: number }
    | { kind: "color", label: string }
    | { kind: "enum", label: string, options: readonly string[] }
    | { kind: "toggle", label: string }

/**
 * What each setting is. Values are in defaults.json, deliberately not here.
 *
 * A spec asserts that this and the file cover exactly the same keys, so the two
 * cannot drift.
 */
export const SETTINGS_SCHEMA: Readonly<Record<string, SettingSpec>> = {
    "render.scale": {
        kind: "number", label: "resolution scale", min: 0.05, max: 2, step: 0.05
    },
    "render.simHz": {
        kind: "number", label: "simulation Hz", min: 20, max: 240, step: 10
    },

    "scene.name": {
        kind: "enum", label: "scene", options: ["ships", "chart", "squares"]
    },
    "scene.hullId": {
        // Read from the folder rather than listed, so a new hull file shows up
        // here the same way it shows up in the picker.
        kind: "enum", label: "hull", options: HULLS.map(entry => entry.id)
    },
    "scene.shader": {
        // Likewise from the registry, so adding a mesh shader adds an option.
        kind: "enum", label: "shader", options: MESH_SHADERS.map(shader => shader.id)
    },
    "scene.cellSize": {
        kind: "number", label: "cell size", min: 4, max: 64, step: 2
    },
    "scene.gap": {
        kind: "number", label: "layout gap", min: 0, max: 1, step: 0.05
    },
    "scene.wireColor": { kind: "color", label: "wireframe" },

    "light.color": { kind: "color", label: "colour" },
    "light.intensity": {
        kind: "number", label: "intensity", min: 0, max: 3, step: 0.05
    },
    "light.range": {
        kind: "number", label: "range", min: 0.25, max: 6, step: 0.05
    },
    "light.offsetX": {
        kind: "number", label: "offset x", min: -2, max: 2, step: 0.05
    },
    "light.offsetY": {
        kind: "number", label: "offset y", min: -2, max: 2, step: 0.05
    },

    "shading.blend": {
        // How the light's colour meets the surface's. "additive" can only push
        // a saturated hull toward white; "multiply" keeps its hue and darkens
        // it instead. Only meaningful when the lit shader is selected.
        kind: "enum", label: "blend", options: ["additive", "multiply"]
    },
    "shading.contrast": {
        kind: "number", label: "contrast", min: 0, max: 2, step: 0.01
    },
    "shading.shadowDepth": {
        kind: "number", label: "shadow depth", min: 0, max: 1, step: 0.01
    },
    "shading.tint": {
        // Goes past 1 for the additive blend, where the light's colour is a
        // small addition next to the surface's own and needs the headroom to
        // show at all. Multiply clamps it back to 1 internally.
        kind: "number", label: "tint", min: 0, max: 3, step: 0.01
    },
    "shading.ambientBleed": {
        kind: "number", label: "ambient bleed", min: 0, max: 1, step: 0.01
    },
    "shading.ambientColor": { kind: "color", label: "ambient" },
}

export const DEFAULTS: Readonly<Settings> =
    Object.freeze({ ...(defaultsFile.values as Settings) })

/** Every setting key, in the order defaults.json lists them. */
export const SETTING_KEYS: readonly string[] = Object.keys(DEFAULTS)

/** The part of a key before the dot — what the panel groups by. */
export function settingGroup(key: string): string {
    const dot = key.indexOf(".")
    return dot === -1 ? key : key.slice(0, dot)
}

export interface ResolveResult {
    values: Settings
    /** Anything stored that could not be honoured. */
    warnings: string[]
}

/**
 * Checks one stored value against its spec.
 *
 * @returns the value to use, or undefined to fall back to the default.
 */
function validate(key: string, spec: SettingSpec, value: unknown, warnings: string[]) {
    switch (spec.kind) {
        case "number": {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                warnings.push(`${key}: expected a number, got ${JSON.stringify(value)}`)
                return undefined
            }
            // Clamped rather than rejected: a value from an older, wider range
            // is still closer to what was wanted than the default is.
            const clamped = Math.min(Math.max(value, spec.min), spec.max)
            if (clamped !== value) {
                warnings.push(`${key}: ${value} clamped to ${clamped}`)
            }
            return clamped
        }

        case "color":
            if (!isHexColor(value)) {
                warnings.push(`${key}: not a hex colour: ${JSON.stringify(value)}`)
                return undefined
            }
            return value

        case "enum":
            if (typeof value !== "string" || !spec.options.includes(value)) {
                warnings.push(`${key}: not one of ${spec.options.join(", ")}`)
                return undefined
            }
            return value

        case "toggle":
            if (typeof value !== "boolean") {
                warnings.push(`${key}: expected true or false`)
                return undefined
            }
            return value
    }
}

/**
 * The defaults with a stored diff laid over them.
 *
 * Lenient in the same way the hull loader is: a bad value costs that one
 * setting, not the whole file. Anything rejected falls back to its default and
 * says so in `warnings`.
 *
 * @param stored the parsed contents of localStorage, or anything at all — this
 *        is the boundary where untrusted data becomes typed.
 */
export function resolveSettings(stored: unknown): ResolveResult {
    const values: Settings = { ...DEFAULTS }
    const warnings: string[] = []

    if (stored === null || stored === undefined) return { values, warnings }

    if (typeof stored !== "object") {
        return { values, warnings: ["stored settings are not an object"] }
    }

    const blob = stored as { version?: unknown, values?: unknown }

    // No migration path yet. Discarding is honest — the version field is here
    // so that a migration can be written when one is actually worth having.
    if (blob.version !== SETTINGS_VERSION) {
        return {
            values,
            warnings: [`stored settings are version ${blob.version}, expected ${SETTINGS_VERSION} — discarded`]
        }
    }

    if (typeof blob.values !== "object" || blob.values === null) {
        return { values, warnings: ["stored settings have no `values` object"] }
    }

    for (const [key, value] of Object.entries(blob.values as Record<string, unknown>)) {
        const spec = SETTINGS_SCHEMA[key]
        if (!spec) {
            warnings.push(`${key}: not a known setting — dropped`)
            continue
        }

        const checked = validate(key, spec, value, warnings)
        if (checked !== undefined) values[key] = checked
    }

    return { values, warnings }
}

/** Just the settings that differ from their defaults — what gets stored. */
export function diffFromDefaults(values: Settings): Settings {
    const diff: Settings = {}

    for (const key of SETTING_KEYS) {
        if (key in values && values[key] !== DEFAULTS[key]) diff[key] = values[key]
    }

    return diff
}

/** True if this setting has been changed from what defaults.json says. */
export function isModified(values: Settings, key: string): boolean {
    return key in values && values[key] !== DEFAULTS[key]
}

/** What actually goes into storage. */
export function toStorable(values: Settings) {
    return { version: SETTINGS_VERSION, values: diffFromDefaults(values) }
}
