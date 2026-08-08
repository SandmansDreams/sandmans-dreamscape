import type { Vector2 } from "../physics/core";

// Ambient light? Might just be a shader thing

class Light {
    position: Vector2
    distance: number // How far the light propogates until it stops having an effect, fades out
    rotation?: number // Where the light is pointing
    arcAngle?: number // The distance of the arc that the light produces (for pointed lights)
    //reflection?
    //transparency?
    constructor (
        position: Vector2,
        distance = 10
    ) {
        this.position = position
        this.distance = distance
    }
}