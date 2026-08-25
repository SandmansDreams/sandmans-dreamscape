// Smoothing that does not change with the frame rate

/**
 * Moves `from` toward `to`, leaving `retain` of the gap after a second.
 *
 * Exponential rather than a fixed step per frame, and raised to `dt` rather than
 * multiplied by it, so the same fraction of the gap is left after a second
 * however many steps it took to get there. A per-frame `value += gap * rate`
 * looks identical at 60fps and visibly slower at 30, which is the kind of thing
 * that only ever shows up on somebody else's machine.
 *
 * @param retain 0 snaps immediately, 1 never moves. Small numbers are fast.
 */
export function approach(from: number, to: number, retain: number, dt: number): number {
    if (dt <= 0) return from

    return to + (from - to) * Math.pow(retain, dt)
}
