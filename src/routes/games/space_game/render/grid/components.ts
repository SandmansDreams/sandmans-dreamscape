// What a block is made of, and the stats that follow from that

import { Assert } from "../../assert"
import type { ShipLayer } from "./layers"

/**
 * The categories a component appears under in the builder.
 *
 * A category is a drawer in the UI, not a thing you can place: you place a
 * `crate`, and storage is where you find it. Derived from the array so adding a
 * category is one edit rather than two that can disagree.
 */
export const COMPONENT_KINDS = [
    "hull", // Shape blocks, body of the ship
    "thruster",
    "storage",
    "generator",
    "projector",
    "weapon",
] as const

export type ComponentKind = (typeof COMPONENT_KINDS)[number]

const KIND_SET: ReadonlySet<string> = new Set(COMPONENT_KINDS)

export function isComponentKind(value: unknown): value is ComponentKind {
    return typeof value === "string" && KIND_SET.has(value)
}

/** What every component has, whatever it is. */
export interface ComponentStats {
    /** Damage the block absorbs before it is destroyed. */
    hitPoints: number
    /** Contribution to the ship's mass. Ignored on the cosmetic layer. */
    mass: number
}

/**
 * One placeable thing, and everything true of it at every level.
 *
 * Generic in its stats so a subclass can widen them: a thruster's levels carry
 * thrust, and `statsAt` hands that back without a cast at the call site. The
 * base class holds only what every component answers - the rest is the reason
 * the subclasses exist.
 */
export abstract class Component<S extends ComponentStats = ComponentStats> {
    /** Stable, and the key art files are named after. Never rename one lightly. */
    abstract readonly id: string
    abstract readonly kind: ComponentKind
    abstract readonly name: string
    /** Index 0 is level 1. A type with nothing to upgrade has exactly one. */
    abstract readonly levels: readonly S[]
    /** Layers this type may be placed on. */
    abstract readonly layers: readonly ShipLayer[]

    get maxLevel(): number {
        return this.levels.length
    }

    /** Stats at a level, clamped into the levels that exist. */
    statsAt(level: number): S {
        const index = Math.min(Math.max(Math.round(level), 1), this.levels.length) - 1
        return this.levels[index]!
    }

    canGoOn(layer: ShipLayer): boolean {
        return this.layers.includes(layer)
    }

    /**
     * Art ids to try, most specific first.
     *
     * A level only needs its own file when it genuinely looks different; every
     * other level falls through to the type's one piece of art, and a type with
     * no art at all falls through to the placeholder in `blockDraw`. That is what
     * lets art be authored one piece at a time without the game breaking for want
     * of a file.
     */
    artIds(level: number): readonly string[] {
        return [`${this.id}-l${level}`, this.id]
    }
}

export class HullComponent extends Component {
    readonly kind = "hull"
    // The only type on two layers: a hull block doubles as a cosmetic
    readonly layers = ["hull", "cosmetic"] as const

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly ComponentStats[],
    ) { super() }
}

export interface ThrusterStats extends ComponentStats {
    /** Force at full throttle, before the ship's mass is divided out. */
    thrust: number
}

export class ThrusterComponent extends Component<ThrusterStats> {
    readonly kind = "thruster"
    readonly layers = ["components"] as const

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly ThrusterStats[],
    ) { super() }
}

export interface StorageStats extends ComponentStats {
    /** Units held. What the mass penalty is paid for. */
    capacity: number
}

export class StorageComponent extends Component<StorageStats> {
    readonly kind = "storage"
    readonly layers = ["components"] as const

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly StorageStats[],
    ) { super() }
}

export interface GeneratorStats extends ComponentStats {
    /** Power produced per second. */
    power: number
}

export class GeneratorComponent extends Component<GeneratorStats> {
    readonly kind = "generator"
    readonly layers = ["components"] as const

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly GeneratorStats[],
    ) { super() }
}

export interface ProjectorStats extends ComponentStats {
    /** Cells the field reaches from the projector. */
    radius: number
    /** Power drawn per second while up. */
    draw: number
}

export class ProjectorComponent extends Component<ProjectorStats> {
    readonly kind = "projector"
    readonly layers = ["components"] as const

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly ProjectorStats[],
    ) { super() }
}

export interface WeaponStats extends ComponentStats {
    damage: number
    /** Seconds between damage proc or shot. */
    cooldown: number
    /** Cells the shot travels before it expires. */
    range: number
}

export class WeaponComponent extends Component<WeaponStats> {
    readonly kind = "weapon"
    readonly layers = ["components"] as const

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly WeaponStats[],
    ) { super() }
}

// VALUES TO BE ADJUSTED AS NEEDED
/**
 * Every component the game knows about.
 *
 * Instances rather than a table, because what a thruster has to say about itself
 * is not what a crate has. Stats live here rather than in the ship files so a
 * balance pass is one edit instead of a sweep over every hull; a cell names its
 * type and level and overrides only what genuinely differs.
 */
const REGISTRY: readonly Component[] = [
    new HullComponent("hull-plate", "Hull Plate", [
        { hitPoints: 10, mass: 1 },
        { hitPoints: 15, mass: 2 },
        { hitPoints: 30, mass: 4 },
    ]),

    new ThrusterComponent("ion-thruster", "Ion Thruster", [
        { hitPoints: 8, mass: 2, thrust: 120 },
        { hitPoints: 14, mass: 3, thrust: 220 },
        { hitPoints: 22, mass: 4, thrust: 360 },
    ]),
    new ThrusterComponent("chem-thruster", "Chem Thruster", [
        { hitPoints: 12, mass: 3, thrust: 200 },
        { hitPoints: 18, mass: 5, thrust: 380 },
    ]),

    // Storage carries its cargo's weight too, which is why its mass reads high
    // for how little it survives
    new StorageComponent("crate", "Crate", [
        { hitPoints: 6, mass: 1, capacity: 10 },
        { hitPoints: 12, mass: 2, capacity: 25 },
    ]),
    new StorageComponent("battery", "Battery", [
        { hitPoints: 6, mass: 2, capacity: 40 },
        { hitPoints: 12, mass: 3, capacity: 90 },
    ]),

    new GeneratorComponent("fusion-core", "Fusion Core", [
        { hitPoints: 12, mass: 3, power: 8 },
        { hitPoints: 20, mass: 5, power: 18 },
    ]),

    new ProjectorComponent("shield-projector", "Shield Projector", [
        { hitPoints: 8, mass: 1, radius: 3, draw: 4 },
        { hitPoints: 14, mass: 2, radius: 5, draw: 7 },
    ]),
    new ProjectorComponent("radar-dish", "Radar Dish", [
        { hitPoints: 5, mass: 1, radius: 20, draw: 4 },
        { hitPoints: 10, mass: 2, radius: 40, draw: 7 },
    ]),

    new WeaponComponent("autocannon", "Autocannon", [
        { hitPoints: 10, mass: 2, damage: 3, cooldown: 0.2, range: 18 },
        { hitPoints: 16, mass: 3, damage: 5, cooldown: 0.18, range: 20 },
        { hitPoints: 20, mass: 4, damage: 7, cooldown: 0.16, range: 22 },
        { hitPoints: 24, mass: 6, damage: 9, cooldown: 0.14, range: 24 },
        { hitPoints: 30, mass: 8, damage: 12, cooldown: 0.12, range: 26 },
    ]),
    new WeaponComponent("railgun", "Railgun", [
        { hitPoints: 12, mass: 4, damage: 25, cooldown: 1.6, range: 40 },
        { hitPoints: 20, mass: 6, damage: 40, cooldown: 1.4, range: 48 },
    ]),
]



const BY_ID = new Map<string, Component>()
const BY_KIND = new Map<ComponentKind, Component[]>()

for (const component of REGISTRY) {
    Assert.that(!BY_ID.has(component.id), `two components share the id "${component.id}"`)
    BY_ID.set(component.id, component)

    const bucket = BY_KIND.get(component.kind) ?? []
    bucket.push(component)
    BY_KIND.set(component.kind, bucket)
}

/** What a cell is when its file says nothing. */
export const DEFAULT_TYPE = "hull-plate"

/** The component with this id, or null. For readers, which want to warn. */
export function findComponent(id: string): Component | null {
    return BY_ID.get(id) ?? null
}

/**
 * The component with this id, falling back rather than throwing.
 *
 * Every draw and every mass sum goes through here, so an id that got past the
 * reader must not take the frame down with it.
 */
export function componentById(id: string): Component {
    return BY_ID.get(id) ?? BY_ID.get(DEFAULT_TYPE)!
}

/** Types under one category, which is what the bottom bar lists. */
export function componentsOfKind(kind: ComponentKind): readonly Component[] {
    return BY_KIND.get(kind) ?? []
}

export function kindOf(id: string): ComponentKind {
    return componentById(id).kind
}

export function maxLevel(id: string): number {
    return componentById(id).maxLevel
}

/** Stats for a type at a level, clamped into the levels that exist. */
export function statsFor(id: string, level: number): ComponentStats {
    return componentById(id).statsAt(level)
}

/** Whether the building rules allow this type on this layer. */
export function canPlace(id: string, layer: ShipLayer): boolean {
    return componentById(id).canGoOn(layer)
}