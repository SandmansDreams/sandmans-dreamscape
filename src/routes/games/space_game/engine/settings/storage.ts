import { browser } from "$app/environment"

import { DEFAULTS, resolveSettings, STORAGE_KEY, toStorable, type Settings } from "./index"

/**
 * The localStorage half of settings, kept apart from the rest.
 *
 * Everything in `index.ts` is pure, so it can be specified in Node without a
 * DOM; this file is the only part that knows storage exists. It is also the
 * only part that imports `$app/environment`, which keeps SvelteKit out of the
 * engine's test path.
 *
 * Every access is wrapped: private-browsing modes throw outright on
 * localStorage, and losing settings should cost a console line rather than the
 * page.
 */

/** Settings as stored, or the defaults during SSR and on any failure. */
export function loadSettings(): Settings {
    if (!browser) return { ...DEFAULTS }

    let stored: unknown = null

    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        stored = raw === null ? null : JSON.parse(raw)
    } catch (error) {
        console.warn("settings: could not be read", error)
        return { ...DEFAULTS }
    }

    const { values, warnings } = resolveSettings(stored)
    for (const warning of warnings) console.warn(`settings: ${warning}`)

    return values
}

export function saveSettings(values: Settings) {
    if (!browser) return

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toStorable(values)))
    } catch (error) {
        console.warn("settings: could not be saved", error)
    }
}

export function clearSettings() {
    if (!browser) return

    try {
        localStorage.removeItem(STORAGE_KEY)
    } catch (error) {
        console.warn("settings: could not be cleared", error)
    }
}
