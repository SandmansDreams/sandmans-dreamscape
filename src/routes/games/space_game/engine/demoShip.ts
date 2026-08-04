import type { Grid } from "./grid"
import { loadHull, type HullData } from "./hull"
import demoShipData from "./hulls/demoShip.json"

/**
 * The stand-in hull, loaded from JSON.
 *
 * Kept as a function rather than a module-level constant so callers get a
 * fresh, independently editable Grid each time.
 */
export function buildDemoShip(): Grid {
    return loadHull(demoShipData as HullData, "demoShip")
}
