import { type Cell } from "./builder"

type PlacementLevel = "basic" | "average" | "advanced" | "extreme" | "max"

export abstract class Placement {
    level: PlacementLevel = "basic"
    rotation: number = 0

    draw() {}
}

