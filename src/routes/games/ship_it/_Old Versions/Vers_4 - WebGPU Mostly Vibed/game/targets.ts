// Drifting rocks to shoot at, and what happens when one breaks

import type { Vec2 } from "../render/camera"

/**
 * Below this radius a rock is not worth splitting further.
 *
 * In cells. Without a floor, splitting is infinite: every child is a smaller
 * rock that can split again, and the arena fills with dust that costs a frame
 * more than it costs a player anything to clear.
 */
export const SPLIT_FLOOR = 0.45

/** How many pieces a rock comes apart into. v1's spread, which reads well. */
const MIN_SHARDS = 2
const MAX_SHARDS = 7

/** A child's radius, as a fraction of its parent's. */
const SHARD_MIN = 0.2
const SHARD_MAX = 0.5

/** How fast shards push apart, in cells per second. */
const SHARD_SPEED = 1.2

/**
 * Hit points per unit of area.
 *
 * Area rather than radius, so splitting a rock neither creates nor destroys
 * toughness: the shards together take about as much shooting as the parent had
 * left. Radius-proportional health made small rocks disproportionately spongy.
 */
const HP_PER_AREA = 22

/** One rock. Plain data, so a field of them copies and tests cheaply. */
export interface Target {
    position: Vec2
    velocity: Vec2
    /** In cells. */
    radius: number
    hitPoints: number
    /** Radians, purely cosmetic - nothing collides with a corner. */
    angle: number
    spin: number
}

/** What a rock that size starts with. */
export function hitPointsFor(radius: number): number {
    return Math.max(1, Math.round(HP_PER_AREA * radius * radius))
}

export function targetAt(position: Vec2, velocity: Vec2, radius: number, spin = 0): Target {
    return {
        position: { ...position },
        velocity: { ...velocity },
        radius,
        hitPoints: hitPointsFor(radius),
        angle: 0,
        spin,
    }
}

/** Moves and turns a rock. Returns it, mutated - a field of these is a hot loop. */
export function driftTarget(target: Target, dt: number): Target {
    target.position.x += target.velocity.x * dt
    target.position.y += target.velocity.y * dt
    target.angle += target.spin * dt

    return target
}

/** True once a rock has taken all it can. */
export function isDestroyed(target: Target): boolean {
    return target.hitPoints <= 0
}

/**
 * What a destroyed rock leaves behind.
 *
 * Shards fly outward from a ring rather than from the centre, so they separate
 * immediately instead of overlapping for the first half second and looking like
 * one rock that flickered. Anything under the floor is dust and is simply not
 * created - which is what makes the recursion terminate.
 *
 * @param random injected so a test can hand over the sequence it chose
 */
export function splitTarget(target: Target, random: () => number = Math.random): Target[] {
    if (target.radius < SPLIT_FLOOR) return []

    const count = MIN_SHARDS + Math.floor(random() * (MAX_SHARDS - MIN_SHARDS + 1))
    const shards: Target[] = []

    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + (random() - 0.5) * 0.5
        const radius = target.radius * (SHARD_MIN + random() * (SHARD_MAX - SHARD_MIN))
        if (radius < SPLIT_FLOOR) continue

        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const away = SHARD_SPEED * (0.5 + random())

        shards.push(targetAt(
            {
                x: target.position.x + cos * target.radius * 0.5,
                y: target.position.y + sin * target.radius * 0.5,
            },
            {
                x: target.velocity.x + cos * away,
                y: target.velocity.y + sin * away,
            },
            radius,
            (random() - 0.5) * 2,
        ))
    }

    return shards
}
