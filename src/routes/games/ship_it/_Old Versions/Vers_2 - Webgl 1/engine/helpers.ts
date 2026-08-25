import type { Vec3Like } from "ts-gl-matrix"

/** A random vector with each component in -1..1. */
export function randomVec3Signed(): Vec3Like {
    return [
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
    ]
}

/** A random vector with each component in 0..1. */
export function randomVec3Unit(): Vec3Like {
    return [
        Math.random(),
        Math.random(),
        Math.random()
    ]
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

/**
 * Interpolates between two angles the short way round.
 *
 * A plain lerp from 359 degrees to 1 spins almost the whole way backwards;
 * this takes the shortest arc.
 */
export function lerpAngle(a: number, b: number, t: number): number {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a))
    return a + delta * t
}

export function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value
}
