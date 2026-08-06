/** Column-major mat3, which is what uniformMatrix3fv expects. */
export const IDENTITY_2D = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
])

/**
 * Squashes the x axis so a square in model space stays square on screen.
 * Clip space is -1..1 on both axes no matter how wide the canvas is, so
 * without this everything stretches horizontally.
 */
export function aspectScale2D(aspect: number): Float32Array {
    return new Float32Array([
        1 / aspect, 0, 0,
        0,          1, 0,
        0,          0, 1,
    ])
}

/** Counter-clockwise rotation about the origin, aspect-corrected. */
export function rotation2D(radians: number, aspect = 1): Float32Array {
    const c = Math.cos(radians)
    const s = Math.sin(radians)
    return new Float32Array([
         c / aspect, s, 0,
        -s / aspect, c, 0,
         0,          0, 1,
    ])
}
