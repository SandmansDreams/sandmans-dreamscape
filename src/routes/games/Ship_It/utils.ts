export function clamp(max: number, value: number, min = 0) {
    return Math.min(Math.max(min, value), max)
}