import { Vector2 } from "./types";

export function getDistance(a: Vector2, b: Vector2) {
    return  Math.hypot(b.x - a.x, b.y - a.y)
}

export function getRandomVector(xMax: number, yMax: number) {
    const xNegative = Boolean(Math.floor(Math.random()))
    const yNegative = Boolean(Math.floor(Math.random()))
    const x = xNegative ? -Math.random() * xMax : Math.random() * xMax
    const y = yNegative ? -Math.random() * yMax : Math.random() * yMax

    return new Vector2(x, y)
}