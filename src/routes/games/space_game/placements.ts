import { type Cell } from "./builder"

export abstract class Placement {
    level: PlacementLevel = "basic"
    rotation: number = 0

    draw() {}
}



type PlacementLevel = "basic" | "average" | "advanced" | "extreme" | "max"