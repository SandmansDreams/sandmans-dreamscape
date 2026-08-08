import { describe, expect, it } from "vitest"

import { isHexColor } from "./color"
import { HULLS } from "./hulls"
import {
    DEFAULTS, SETTINGS_SCHEMA, SETTINGS_VERSION, SETTING_KEYS,
    diffFromDefaults, isModified, resolveSettings, settingGroup, toStorable,
    type Settings
} from "../settings"

/**
 * Specification for settings.
 *
 * Two things are worth pinning here. One is that defaults.json and the schema
 * describe the same set of keys — they are separate files precisely so the
 * values stay readable, and nothing else would notice them drifting apart.
 *
 * The other is the property the whole design exists for: a setting the user has
 * never touched must keep tracking defaults.json. Get that wrong and the file
 * is write-once, since everyone is pinned to whatever shipped the day they
 * first loaded the page.
 */

function stored(values: Record<string, unknown>, version = SETTINGS_VERSION) {
    return { version, values }
}

describe("schema and defaults", () => {
    it("cover exactly the same keys", () => {
        expect(Object.keys(SETTINGS_SCHEMA).sort()).toEqual([...SETTING_KEYS].sort())
    })

    it("gives every setting a label", () => {
        for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
            expect(spec.label.length, key).toBeGreaterThan(0)
        }
    })

    // Each default has to survive its own validation, or a fresh visitor would
    // be greeted by a console full of warnings about the file we shipped.
    it("holds a default that is valid under its own spec", () => {
        const { values, warnings } = resolveSettings(stored({ ...DEFAULTS }))

        expect(warnings).toEqual([])
        expect(values).toEqual(DEFAULTS)
    })

    it("keeps numeric defaults inside their range", () => {
        for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
            if (spec.kind !== "number") continue

            expect(DEFAULTS[key], key).toBeGreaterThanOrEqual(spec.min)
            expect(DEFAULTS[key], key).toBeLessThanOrEqual(spec.max)
        }
    })

    it("keeps colour defaults parseable", () => {
        for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
            if (spec.kind !== "color") continue
            expect(isHexColor(DEFAULTS[key]), key).toBe(true)
        }
    })

    it("takes the hull options from the hulls folder", () => {
        const spec = SETTINGS_SCHEMA["scene.hullId"]

        expect(spec.kind).toBe("enum")
        if (spec.kind !== "enum") return

        expect([...spec.options]).toEqual(HULLS.map(entry => entry.id))
        expect(spec.options).toContain(DEFAULTS["scene.hullId"])
    })

    it("groups by the part before the dot", () => {
        expect(settingGroup("light.color")).toBe("light")
        expect(settingGroup("bare")).toBe("bare")
    })
})

describe("resolveSettings", () => {
    it("returns the defaults for nothing stored", () => {
        expect(resolveSettings(null).values).toEqual(DEFAULTS)
        expect(resolveSettings(undefined).warnings).toEqual([])
    })

    it("lays a stored value over its default", () => {
        const { values, warnings } = resolveSettings(stored({ "light.intensity": 2 }))

        expect(values["light.intensity"]).toBe(2)
        expect(values["light.range"]).toBe(DEFAULTS["light.range"])
        expect(warnings).toEqual([])
    })

    it("never returns a partial bag", () => {
        const { values } = resolveSettings(stored({ "light.intensity": 2 }))
        expect(Object.keys(values).sort()).toEqual([...SETTING_KEYS].sort())
    })

    describe("bad input", () => {
        it("drops an unknown key and keeps the rest", () => {
            const { values, warnings } = resolveSettings(stored({
                "light.wavelength": 550,
                "light.intensity": 2
            }))

            expect(values["light.wavelength"]).toBeUndefined()
            expect(values["light.intensity"]).toBe(2)
            expect(warnings[0]).toContain("light.wavelength")
        })

        it("clamps a number outside its range rather than discarding it", () => {
            const { values, warnings } = resolveSettings(stored({ "light.intensity": 99 }))

            expect(values["light.intensity"]).toBe(3)
            expect(warnings[0]).toContain("clamped")
        })

        it("falls back when a number is not a number", () => {
            const { values, warnings } = resolveSettings(stored({ "light.intensity": "bright" }))

            expect(values["light.intensity"]).toBe(DEFAULTS["light.intensity"])
            expect(warnings).toHaveLength(1)
        })

        it("falls back on a malformed colour", () => {
            const { values, warnings } = resolveSettings(stored({ "light.color": "chartreuse" }))

            expect(values["light.color"]).toBe(DEFAULTS["light.color"])
            expect(warnings[0]).toContain("hex")
        })

        it("falls back on an enum value it does not offer", () => {
            const { values, warnings } = resolveSettings(stored({ "scene.name": "fireworks" }))

            expect(values["scene.name"]).toBe(DEFAULTS["scene.name"])
            expect(warnings).toHaveLength(1)
        })

        it("discards a blob from another version", () => {
            const { values, warnings } = resolveSettings(
                stored({ "light.intensity": 2 }, SETTINGS_VERSION + 1)
            )

            expect(values).toEqual(DEFAULTS)
            expect(warnings[0]).toContain("version")
        })

        it("survives junk", () => {
            expect(resolveSettings("nonsense").values).toEqual(DEFAULTS)
            expect(resolveSettings(42).values).toEqual(DEFAULTS)
            expect(resolveSettings({ version: SETTINGS_VERSION }).values).toEqual(DEFAULTS)
            expect(resolveSettings(stored({})).values).toEqual(DEFAULTS)
        })
    })
})

describe("diffFromDefaults", () => {
    it("is empty when nothing has been changed", () => {
        expect(diffFromDefaults({ ...DEFAULTS })).toEqual({})
    })

    it("holds only what differs", () => {
        const values: Settings = { ...DEFAULTS, "light.intensity": 2 }

        expect(diffFromDefaults(values)).toEqual({ "light.intensity": 2 })
    })

    it("ignores keys that are not settings", () => {
        const values: Settings = { ...DEFAULTS, "not.a.setting": 1 }

        expect(diffFromDefaults(values)).toEqual({})
    })

    it("round-trips through resolve", () => {
        const values: Settings = {
            ...DEFAULTS,
            "light.intensity": 2,
            "light.color": "#ff0000",
            "scene.name": "chart"
        }

        expect(resolveSettings(toStorable(values)).values).toEqual(values)
    })

    /**
     * The reason the storage holds a diff at all.
     *
     * Simulated by resolving a diff that omits the key against a default that
     * has since moved: the resolved value must be the new default, not the old
     * one. Storing the whole bag would pin it forever.
     */
    it("lets a changed default reach a user who never touched that setting", () => {
        const diff = diffFromDefaults({ ...DEFAULTS, "light.intensity": 2 })

        expect(diff["shading.contrast"]).toBeUndefined()
        expect(resolveSettings({ version: SETTINGS_VERSION, values: diff })
            .values["shading.contrast"]).toBe(DEFAULTS["shading.contrast"])
    })
})

describe("isModified", () => {
    it("reports which settings have moved", () => {
        const values: Settings = { ...DEFAULTS, "light.intensity": 2 }

        expect(isModified(values, "light.intensity")).toBe(true)
        expect(isModified(values, "light.range")).toBe(false)
    })
})
