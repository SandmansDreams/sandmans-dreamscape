// What a block is made of, and the stats that follow from that

import { Assert } from "../../assert"
import type { ShipLayer } from "./layers"

/**
 * The categories a component appears under in the builder.
 *
 * A category is a drawer in the UI, not a thing you can place: you place a
 * `crate`, and cargo is where you find it. Derived from the array so adding a
 * category is one edit rather than two that can disagree.
 */
export const COMPONENT_KINDS = [
    "hull", // Shape blocks, body of the ship
    "thruster",
    "cargo",
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
    /**
     * What this block costs to build.
     *
     * On the base rather than a subclass so no consumer needs an instanceof: what
     * a part is worth is a number in a table, not a branch somewhere that has to
     * remember which kinds are exempt.
     *
     * Plating is priced too - a bigger hull is a more expensive ship. Only the
     * *cosmetic layer* is free, and that rule lives in shipCost because it is
     * about where a block sits rather than about what it is: the same plate costs
     * money on the hull and nothing as decoration.
     */
    cost: number
}

/**
 * One placeable thing, and everything true of it at every level.
 *
 * Generic in its stats so a subclass can widen them: a thruster's levels carry
 * thrust, and `statsAt` hands that back without a cast at the call site. The
 * base class holds only what every component answers - the rest is the reason
 * the subclasses exist.
 */
/** One labelled number, for a readout that has no idea what it is showing. */
export interface StatLine {
    label: string
    value: string
}

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
     * Numbers beyond the ones every component has.
     *
     * Empty by default and overridden where a subclass has something of its own
     * to say. This is the same reason the subclasses exist at all: what a thruster
     * has to report is not what a crate has, and a panel that switched on the
     * concrete class would hold every component's vocabulary instead.
     */
    extraStats(_level: number): readonly StatLine[] {
        return []
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
    /** Power drawn per second at full throttle, in proportion below that. */
    draw: number
}

export class ThrusterComponent extends Component<ThrusterStats> {
    readonly kind = "thruster"
    readonly layers = ["components"] as const

    extraStats(level: number): readonly StatLine[] {
        const stats = this.statsAt(level)
        return [
            { label: "thrust", value: String(stats.thrust) },
            { label: "power", value: `${stats.draw}/s` },
        ]
    }

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly ThrusterStats[],
    ) { super() }
}

/**
 * A container, and what filling it costs in mass.
 *
 * Shared by the crate and the fuel tank because their shape is genuinely the
 * same: hold N units, weigh more when full. *What* is held is the class's
 * business rather than the stats', for the same reason two different projectors
 * already share ProjectorStats.
 */
export interface LoadStats extends ComponentStats {
    /** Units held at this level. */
    capacity: number
    /**
     * Mass a full load adds, on top of the empty structure's `mass`.
     *
     * Separate from `mass` so the builder can total a dry hull honestly while the
     * flight sim flies the loaded one. Applied in steps rather than continuously -
     * see LOAD_STAGES in game/physics.ts - because a mass changing by a float
     * every frame would rebuild the ship's centre and inertia every frame with it.
     */
    loadMass: number
}

/** Holds cargo. Nothing fills one yet, which is why capacity is still unread. */
export class CargoComponent extends Component<LoadStats> {
    readonly kind = "cargo"
    readonly layers = ["components"] as const

    extraStats(level: number): readonly StatLine[] {
        const stats = this.statsAt(level)
        return [
            { label: "capacity", value: String(stats.capacity) },
            { label: "full mass", value: String(stats.mass + stats.loadMass) },
        ]
    }

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly LoadStats[],
    ) { super() }
}

/** Holds the fuel generators burn. Same shape as cargo, different contents. */
export class TankComponent extends Component<LoadStats> {
    readonly kind = "cargo"
    readonly layers = ["components"] as const

    extraStats(level: number): readonly StatLine[] {
        const stats = this.statsAt(level)
        return [
            { label: "fuel", value: String(stats.capacity) },
            { label: "full mass", value: String(stats.mass + stats.loadMass) },
        ]
    }

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly LoadStats[],
    ) { super() }
}

export interface BatteryStats extends ComponentStats {
    /** Power held. Charge weighs nothing, which is why there is no loadMass. */
    capacity: number
    /**
     * Cells this carries power across.
     *
     * A battery inside a generator's reach relays it this much further, which is
     * what makes it a distribution part rather than just a bigger tank.
     */
    reach: number
}

/**
 * Stores power and extends a generator's reach.
 *
 * Its own class rather than a CargoComponent because `capacity` meant two
 * unrelated things while they shared one. Still `kind: "cargo"`, so it stays in
 * the same drawer in the builder and the C key keeps meaning what it means.
 */
export class BatteryComponent extends Component<BatteryStats> {
    readonly kind = "cargo"
    readonly layers = ["components"] as const

    extraStats(level: number): readonly StatLine[] {
        const stats = this.statsAt(level)
        return [
            { label: "stores", value: String(stats.capacity) },
            { label: "reach", value: `${stats.reach} cells` },
        ]
    }

    constructor(
        readonly id: string,
        readonly name: string,
        readonly levels: readonly BatteryStats[],
    ) { super() }
}

export interface GeneratorStats extends ComponentStats {
    /** Power produced per second at full output. */
    power: number
    /**
     * Power held on the generator itself.
     *
     * Without it a core-only ship could never fire a railgun: producing 8/s cannot
     * pay a 12-cost shot inside one frame, however long it has been idle.
     */
    buffer: number
    /** Fuel burned per second at full output, in proportion below that. */
    burn: number
    /** Cells it powers around itself. */
    reach: number
}

export class GeneratorComponent extends Component<GeneratorStats> {
    readonly kind = "generator"
    readonly layers = ["components"] as const

    extraStats(level: number): readonly StatLine[] {
        const stats = this.statsAt(level)
        return [
            { label: "power", value: `${stats.power}/s` },
            { label: "buffer", value: String(stats.buffer) },
            { label: "fuel", value: `${stats.burn}/s` },
            { label: "reach", value: `${stats.reach} cells` },
        ]
    }

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

    extraStats(level: number): readonly StatLine[] {
        const stats = this.statsAt(level)
        return [
            { label: "radius", value: `${stats.radius} cells` },
            { label: "power", value: `${stats.draw}/s` },
        ]
    }
}

export interface WeaponStats extends ComponentStats {
    damage: number
    /** Seconds between damage proc or shot. */
    cooldown: number
    /** Cells the shot travels before it expires. */
    range: number
    /** Power spent per *shot* - not per second, unlike every other draw here. */
    draw: number
    /**
     * Radians per second the mount can slew, or 0 for one welded to its facing.
     *
     * The difference between a turret that tracks the cursor and a railgun the
     * pilot has to aim by turning the whole ship, which is what finally makes a
     * weapon's facing in the builder matter.
     */
    traverse: number
}

export class WeaponComponent extends Component<WeaponStats> {
    readonly kind = "weapon"
    readonly layers = ["components"] as const

    extraStats(level: number): readonly StatLine[] {
        const stats = this.statsAt(level)
        return [
            { label: "damage", value: String(stats.damage) },
            { label: "cooldown", value: `${stats.cooldown}s` },
            { label: "range", value: `${stats.range} cells` },
            { label: "power", value: `${stats.draw}/shot` },
            { label: "mount", value: stats.traverse > 0 ? "turret" : "fixed" },
        ]
    }

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
        { hitPoints: 10, mass: 1, cost: 3 },
        { hitPoints: 15, mass: 2, cost: 7 },
        { hitPoints: 30, mass: 4, cost: 16 },
    ]),

    // Ion is the efficient family and chem the thirsty-but-strong one: chem gives
    // more thrust per mass and far less per watt, which is the whole difference
    // between them. Higher levels are slightly more efficient, so an upgrade is a
    // gain rather than just a bigger bill.
    new ThrusterComponent("ion-thruster", "Ion Thruster", [
        { hitPoints: 8, mass: 2, cost: 30, thrust: 120, draw: 3 },
        { hitPoints: 14, mass: 3, cost: 75, thrust: 220, draw: 5 },
        { hitPoints: 22, mass: 4, cost: 160, thrust: 360, draw: 7.5 },
    ]),
    new ThrusterComponent("chem-thruster", "Chem Thruster", [
        { hitPoints: 12, mass: 3, cost: 45, thrust: 200, draw: 8 },
        { hitPoints: 18, mass: 5, cost: 110, thrust: 380, draw: 14 },
    ]),

    new CargoComponent("crate", "Crate", [
        { hitPoints: 6, mass: 1, cost: 15, capacity: 10, loadMass: 5 },
        { hitPoints: 12, mass: 2, cost: 35, capacity: 25, loadMass: 13 },
    ]),
    new BatteryComponent("battery", "Battery", [
        { hitPoints: 6, mass: 2, cost: 40, capacity: 40, reach: 5 },
        { hitPoints: 12, mass: 3, cost: 95, capacity: 90, reach: 8 },
    ]),
    // After the crate on purpose: componentsOfKind("cargo")[0] is the target a
    // legacy `k: "cargo"` file migrates to, and that has to stay the crate
    new TankComponent("fuel-tank", "Fuel Tank", [
        { hitPoints: 10, mass: 2, cost: 25, capacity: 120, loadMass: 6 },
        { hitPoints: 18, mass: 4, cost: 60, capacity: 300, loadMass: 15 },
    ]),

    // A buffer of roughly two seconds of its own output, which is what lets a
    // ship with no battery charge up and still fire a railgun
    new GeneratorComponent("fusion-core", "Fusion Core", [
        { hitPoints: 12, mass: 3, cost: 90, power: 8, buffer: 16, burn: 0.6, reach: 6 },
        { hitPoints: 20, mass: 5, cost: 220, power: 18, buffer: 36, burn: 1.2, reach: 9 },
    ]),

    new ProjectorComponent("shield-projector", "Shield Projector", [
        { hitPoints: 8, mass: 1, cost: 70, radius: 3, draw: 4 },
        { hitPoints: 14, mass: 2, cost: 165, radius: 5, draw: 7 },
    ]),
    new ProjectorComponent("radar-dish", "Radar Dish", [
        { hitPoints: 5, mass: 1, cost: 55, radius: 20, draw: 4 },
        { hitPoints: 10, mass: 2, cost: 130, radius: 40, draw: 7 },
    ]),

    // Both weapons cost about the same to run flat out at L1 - 5/s against 7.5/s -
    // so the difference between them is burst versus trickle rather than budget.
    // An L5 autocannon on continuous fire wants 30/s, nearly two L2 cores: a ship
    // that mounts one is built around it.
    new WeaponComponent("autocannon", "Autocannon", [
        { hitPoints: 10, mass: 2, cost: 50, damage: 3, cooldown: 0.2, range: 18, draw: 1, traverse: 3 },
        { hitPoints: 16, mass: 3, cost: 90, damage: 5, cooldown: 0.18, range: 20, draw: 1.6, traverse: 3 },
        { hitPoints: 20, mass: 4, cost: 150, damage: 7, cooldown: 0.16, range: 22, draw: 2.2, traverse: 3 },
        { hitPoints: 24, mass: 6, cost: 240, damage: 9, cooldown: 0.14, range: 24, draw: 2.8, traverse: 3 },
        { hitPoints: 30, mass: 8, cost: 380, damage: 12, cooldown: 0.12, range: 26, draw: 3.6, traverse: 3 },
    ]),
    // traverse 0: a railgun is welded to its facing and aimed by turning the ship
    new WeaponComponent("railgun", "Railgun", [
        { hitPoints: 12, mass: 4, cost: 180, damage: 25, cooldown: 1.6, range: 40, draw: 12, traverse: 0 },
        { hitPoints: 20, mass: 6, cost: 340, damage: 40, cooldown: 1.4, range: 48, draw: 18, traverse: 0 },
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

/**
 * Every component the game knows about, in registration order.
 *
 * For callers that have to cover the whole set rather than look one up - the art
 * coverage test being the reason it exists. Derived from the registry, so a
 * component added below is a component they see.
 */
export const ALL_COMPONENTS: readonly Component[] = REGISTRY

/**
 * Every component that draws as authored art.
 *
 * Hulls are excluded because they draw as their shape instead - see `artFor` in
 * blockDraw. Kept here rather than as a filter at the call site so the art
 * coverage test still fails the moment a new *component* arrives with no art,
 * which is the whole reason that test exists.
 */
export const ART_COMPONENTS: readonly Component[] = REGISTRY.filter(
    (component) => component.kind !== "hull",
)

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