/**
 * A ship is several grids stacked, one per layer, drawn in this order.
 *
 * Array order is render order, bottom to top - do not reorder casually.
 */
export const SHIP_LAYERS = [
    /** The body of the ship, where everything else is placed atop. */
    "hull",
    /** Every machine: thrusters, generators, storage, weapons, projectors. */
    "components",
    /** Blocks placed purely for looks. Free, weightless, and drawn over all. */
    "cosmetic",
] as const

export type ShipLayer = typeof SHIP_LAYERS[number]