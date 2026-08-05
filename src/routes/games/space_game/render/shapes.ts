import type { Mat3Like, Vec3Like } from "ts-gl-matrix"

abstract class Shape {
    outputArray: number[] = []

    constructor () {

    }
}

export class Triangle {
    verticies: Mat3Like

    constructor (
        data: number[]
    ) {
        this.verticies = data
    }
}