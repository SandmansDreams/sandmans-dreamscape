/** Simple clamp (max | val | min), default min is 0 */
export function clamp(max: number, value: number, min = 0) {
    return Math.min(Math.max(min, value), max)
}

/** Rounds bytes up to nearest multiple of 4
 * - WebGPU requires buffer sizes and write offsets to be multiples of 4 bytes
*/
export function roundBytesToNearest4x(bytes: number): number {
    return (bytes + 3) & ~3
}