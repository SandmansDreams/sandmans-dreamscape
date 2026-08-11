/**
 * A ship is several grids stacked, one per layer, drawn in this order.
 *
 * Array order is render order, bottom to top - do not reorder casually.
 */
export const SHIP_LAYERS = [
    /** The body of the ship, where everything else is placed atop. */
    "hull",
    /** Things it does not matter if a block covers: thrusters, generators. */
    "coverable",
    /** Hull blocks placed purely for looks. Free, and weightless. */
    "cosmetic",
    /** Anything that is neither hull nor coverable. Mainly weapons. */
    "placement",
] as const

export type ShipLayer = typeof SHIP_LAYERS[number]
