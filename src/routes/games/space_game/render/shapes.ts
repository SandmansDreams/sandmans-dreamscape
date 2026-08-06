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
        this.verticies = new Float32Array(data)
    }
}

export function quad(x: number, y: number, size: number): number[] {
    const h = size / 2
    return [
        x - h, y - h,   x + h, y - h,   x + h, y + h,
        x - h, y - h,   x + h, y + h,   x - h, y + h,
    ]
}

/** One triangle, apex up, centered on (x, y). */
export function triangle(x: number, y: number, size: number): number[] {
    const h = size / 2
    return [
        x,     y + h,   // apex
        x - h, y - h,   // bottom left
        x + h, y - h,   // bottom right
    ]
}