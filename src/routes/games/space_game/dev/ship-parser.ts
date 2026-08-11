// Ships can be converted to and from a single string for sharing purposes

import type { Grid } from "../render/grid/grid";
import type { ShipLayer } from "../render/grid/layers";

export function shipToJSON(shipLayers: Record<ShipLayer, Grid>) {
    const json = JSON.stringify(shipLayers)
    console.log(shipLayers)
}

export function JSONToShip(filePath: string) {
    return
}