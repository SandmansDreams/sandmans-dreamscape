// What the ship editor is about to place

import { DEFAULT_KIND, type ComponentKind } from "./components"
import { SHIP_LAYERS, type ShipLayer } from "./layers"
import type { BlockShape } from "./shapes"
import { loadStore, saveStore } from "../../settings/storage"

/**
 * `select` is the "look, do not touch" tool: clicking still picks the cell the
 * info panel describes, but nothing is placed or removed.
 */
export type BrushTool = "build" | "destroy" | "select"

/** Fields whose value must be one of a known set, not merely the right type. */
const ALLOWED: Partial<Record<keyof Brush, readonly string[]>> = {
    tool: ["build", "destroy", "select"],
    layer: SHIP_LAYERS,
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
    kind: ComponentKind
    level: number
    /** 0-3 as N/E/S/W. */
    facing: number
    /** Hex, because that is what an <input type="color"> speaks. */
    color: string
    emission: number
}

export const DEFAULT_BRUSH: Brush = {
    layer: "hull",
    tool: "build",
    shape: "full",
    turns: 0,
    mirrored: false,
    kind: DEFAULT_KIND,
    level: 1,
    facing: 0,
    color: "#94a1b3",
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

        const allowed = ALLOWED[key]
        if (allowed && !allowed.includes(value as string)) continue
        
        // Same primitive type as the default is the whole check: every field is a
        // string, number or boolean, and a wrong one is not worth reasoning about
        if (typeof value === typeof DEFAULT_BRUSH[key]) (brush[key] as unknown) = value
    }

    return brush
}

export function saveBrush(brush: Brush): void {
    saveStore(STORAGE_KEY, brush)
}
