// What the ship editor is about to place

import { canPlace, DEFAULT_TYPE, findComponent } from "./components"
import { SHIP_LAYERS, type ShipLayer } from "./layers"
import type { BlockShape } from "./shapes"
import { loadStore, saveStore } from "../../settings/storage"

/**
 * `select` is the "look, do not touch" tool: clicking still picks the cell the
 * info panel describes, but nothing is placed or removed.
 */
export type BrushTool = "build" | "destroy" | "select"

/**
 * Fields that must name something real, not merely be the right type.
 *
 * A predicate rather than a list because `type` is checked against the registry,
 * which no literal array could stay in step with.
 */
const VALID: Partial<Record<keyof Brush, (value: unknown) => boolean>> = {
    tool: (value) => value === "build" || value === "destroy" || value === "select",
    layer: (value) => SHIP_LAYERS.includes(value as ShipLayer),
    type: (value) => typeof value === "string" && findComponent(value) !== null,
}

/**
 * The editor's brush.
 *
 * Deliberately not a settings schema: the builder panel owns this, and keeping
 * it out of the values bag means a field can be whatever type suits it rather
 * than being squeezed into number | boolean | string. `facing` is a plain 0-3
 * instead of the "N"/"E"/"S"/"W" a selection setting would have forced.
 */
export interface Brush {
    layer: ShipLayer
    tool: BrushTool
    shape: BlockShape
    turns: number
    mirrored: boolean
    /** A registry id, so the brush names a crate rather than "some cargo". */
    type: string
    level: number
    /** 0-3 as N/E/S/W. */
    facing: number
    /** Hex, because that is what an <input type="color"> speaks. */
    color: string
    /**
     * The accent tint, or "" to leave the art's own accent alone.
     *
     * A string rather than a nullable Color because the whole brush is primitives
     * - that is what makes loadBrush's type check the only validation it needs.
     */
    accentColor: string
    emission: number
}

export const DEFAULT_BRUSH: Brush = {
    layer: "hull",
    tool: "build",
    shape: "full",
    turns: 0,
    mirrored: false,
    type: DEFAULT_TYPE,
    level: 1,
    facing: 0,
    color: "#94a1b3",
    accentColor: "",
    emission: 0,
}

const STORAGE_KEY = "space-game-brush"

/**
 * The saved brush, with anything missing or wrong filled from the defaults.
 *
 * Stored JSON is whatever a previous build wrote, so a renamed field or a
 * changed type would otherwise reach the editor as garbage - the same reason
 * settings are coerced rather than trusted.
 */
export function loadBrush(): Brush {
    const stored = loadStore(STORAGE_KEY)
    if (stored == null || typeof stored !== "object") return { ...DEFAULT_BRUSH }

    const brush = { ...DEFAULT_BRUSH }
    const bag = stored as Record<string, unknown>

    for (const key of Object.keys(DEFAULT_BRUSH) as (keyof Brush)[]) {
        const value = bag[key]

        const valid = VALID[key]
        if (valid && !valid(value)) continue

        // Same primitive type as the default is the whole check: every field is a
        // string, number or boolean, and a wrong one is not worth reasoning about
        if (typeof value === typeof DEFAULT_BRUSH[key]) (brush[key] as unknown) = value
    }

    // Only while building: destroy and select reach every layer, so a brush saved
    // mid-erase on the cosmetic layer should come back to exactly that
    if (brush.tool === "build") brush.layer = layerFor(brush.type, brush.layer)

    return brush
}

/**
 * A layer the type is actually allowed on, keeping the stored one when it works.
 *
 * Fields are validated one at a time, which cannot catch a pair that is
 * individually fine and jointly impossible: a stored layer this build no longer
 * has falls back to hull, and a crate cannot go there. The editor then shows
 * that layer as selected and disabled at once, and stays wrong until the next
 * category click puts the two back in step.
 */
export function layerFor(type: string, layer: ShipLayer): ShipLayer {
    if (canPlace(type, layer)) return layer

    // No legal layer at all should be impossible, but a registry mid-edit could
    // manage it, and a brush is not worth throwing over
    return SHIP_LAYERS.find((option) => canPlace(type, option)) ?? layer
}

export function saveBrush(brush: Brush): void {
    saveStore(STORAGE_KEY, brush)
}
