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

/**
 * World -> clip. `viewHeight` is how many world units fit vertically;
 * the width follows from the aspect ratio so nothing stretches.
 */
export function orthographic2D(viewHeight: number, aspect: number): Float32Array {
    const py = 2 / viewHeight
    const px = py / aspect
    return new Float32Array([
        px, 0,  0,
        0,  py, 0,
        0,  0,  1,
    ])
}

/**
 * World -> clip, combined with one sprite's translate/rotate/scale.
 *
 * Composed by hand instead of multiplying two mat3s, because this runs once
 * per square per frame — and `out` is reused so the benchmark measures draw
 * calls rather than garbage collection.
 */
export function spriteTransform2D(
    x: number,
    y: number,
    radians: number,
    scale: number,
    viewHeight: number,   // world units visible vertically
    aspect: number,
    out: Float32Array,
): Float32Array {
    const py = 2 / viewHeight
    const px = py / aspect

    const c = Math.cos(radians) * scale
    const s = Math.sin(radians) * scale

    out[0] =  px * c;  out[1] = py * s;  out[2] = 0   // column 0
    out[3] = -px * s;  out[4] = py * c;  out[5] = 0   // column 1
    out[6] =  px * x;  out[7] = py * y;  out[8] = 1   // column 2

    return out
}