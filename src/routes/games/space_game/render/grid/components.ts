// What a block is made of, and the stats that follow from that

import type { ShipLayer } from "./layers"

export type ComponentKind =
    | "hull" // Shape blocks, body of the ship
    | "thruster" 
    | "storage"
    | "generator"
    | "projector"
    | "weapon"

export interface ComponentStats {
    /** Damage the block absorbs before it is destroyed. */
    hitPoints: number
    /** Contribution to the ship's mass. Ignored on the cosmetic layer. */
    mass: number
}

export interface ComponentDefinition {
    /** Stats by level, index 0 being level 1. Cosmetic-only kinds need just one. */
    readonly levels: readonly ComponentStats[]
    /** Layers this kind may be placed on. */
    readonly layers: readonly ShipLayer[]
}


// VALUES TO BE ADJUSTED AS NEEDED 
/**
 * Every component, its levels and where it may go.
 *
 * Stats live here rather than in the ship files so a balance pass is one edit
 * instead of a sweep over every hull. A cell names its kind and level and
 * overrides only what genuinely differs.
 *
 * `layers` is the placement rule table: hull blocks double as cosmetics, which
 * is why hull is the only kind listed on two layers.
 */
export const COMPONENTS: Record<ComponentKind, ComponentDefinition> = {
    hull: {
        layers: ["hull", "cosmetic"],
        levels: [
            { hitPoints: 10, mass: 1 },
            { hitPoints: 15, mass: 2 },
            { hitPoints: 30, mass: 4 },
        ],
    },
    thruster: {
        layers: ["coverable"],
        levels: [
            { hitPoints: 8, mass: 2 },
            { hitPoints: 14, mass: 3 },
            { hitPoints: 22, mass: 4 },
        ],
    },
    storage: { // Special mass also due to storage containing things
        layers: ["coverable"],
        levels: [
            { hitPoints: 6, mass: 1 },
            { hitPoints: 12, mass: 2 },
        ],
    },
    generator: {
        layers: ["coverable"],
        levels: [
            { hitPoints: 12, mass: 3 },
            { hitPoints: 20, mass: 5 },
        ],
    },
    projector: {
        layers: ["placement"],
        levels: [
            { hitPoints: 8, mass: 1 },
            { hitPoints: 14, mass: 2 },
        ],
    },
    weapon: {
        layers: ["placement"],
        levels: [
            { hitPoints: 10, mass: 2 },
            { hitPoints: 16, mass: 3 },
            { hitPoints: 20, mass: 4 },
            { hitPoints: 24, mass: 6 },
            { hitPoints: 30, mass: 8 },
        ],
    },
}

/** What a cell is when its file says nothing. */
export const DEFAULT_KIND: ComponentKind = "hull"

export const COMPONENT_KINDS = Object.keys(COMPONENTS) as readonly ComponentKind[]

export function isComponentKind(value: unknown): value is ComponentKind {
    return typeof value === "string" && value in COMPONENTS
}

export function maxLevel(kind: ComponentKind): number {
    return COMPONENTS[kind].levels.length
}

/** Stats for a kind at a level, clamped into the levels that exist. */
export function statsFor(kind: ComponentKind, level: number): ComponentStats {
    const levels = COMPONENTS[kind].levels
    const index = Math.min(Math.max(Math.round(level), 1), levels.length) - 1
    return levels[index]!
}

/** Whether the building rules allow this kind on this layer. */
export function canPlace(kind: ComponentKind, layer: ShipLayer): boolean {
    return COMPONENTS[kind].layers.includes(layer)
}