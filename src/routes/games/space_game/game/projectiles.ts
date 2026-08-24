// Shots in flight, and what they hit

import type { Vec2 } from "../render/camera"
import { isDestroyed, type Target } from "./targets"

/**
 * The last of a shot's range, over which it fades out.
 *
 * A round that reaches its limit and simply stops being drawn reads as a
 * rendering fault - the eye catches the disappearance, not the distance. Fading
 * the tail end says "this went as far as it goes" instead.
 */
const FADE_FRACTION = 0.3

/** One shot. Plain data, held in a fixed pool. */
export interface Projectile {
    position: Vec2
    velocity: Vec2
    damage: number
    /** Cells left before it expires, counted down as it travels. */
    range: number
    /** What it was fired with, so the last of it can be faded against something. */
    spawnRange: number
}

/**
 * How brightly a shot still draws, 1 down to 0 as it runs out of range.
 *
 * Full brightness for most of the flight and fading only over the tail, rather
 * than dimming the whole way: a round should look like a round for as long as it
 * is one, and start going out only when it is about to.
 */
export function projectileFade(projectile: Projectile): number {
    const over = projectile.spawnRange * FADE_FRACTION
    if (over <= 0) return projectile.range > 0 ? 1 : 0

    return Math.min(Math.max(projectile.range / over, 0), 1)
}

/** What a weapon asks for when it fires. */
export interface Shot {
    at: Vec2
    /** Unit vector. */
    direction: Vec2
    /** Cells per second, before the ship's own velocity is added. */
    speed: number
    /** The ship's velocity, so a shot from a moving hull leads rather than trails. */
    carry: Vec2
    damage: number
    range: number
}

/** A shot that connected, for whoever wants to make sparks where it landed. */
export interface Impact {
    at: Vec2
    target: Target
    damage: number
    /** True when this was the hit that finished the rock off. */
    destroyed: boolean
}

/**
 * How close a shot passes to a rock's centre, along the step it just took.
 *
 * Swept rather than a point test at the frame's end position: a railgun round
 * covers eighty cells a second, which at a long frame is several cells of travel
 * in one step. v1 tested the end point only and its fast rounds went straight
 * through small rocks. Returns the squared distance, since every caller compares
 * it against a squared radius.
 */
export function sweptDistanceSquared(from: Vec2, to: Vec2, at: Vec2): number {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lengthSquared = dx * dx + dy * dy

    // A shot that did not move is just a point, and projecting onto a zero-length
    // segment divides by nothing
    if (lengthSquared <= 0) {
        const ox = at.x - from.x
        const oy = at.y - from.y
        return ox * ox + oy * oy
    }

    // Clamped, so the nearest point is on the step actually taken rather than on
    // the infinite line through it - a rock behind the muzzle is not in the way
    const along = Math.min(Math.max(((at.x - from.x) * dx + (at.y - from.y) * dy) / lengthSquared, 0), 1)

    const nx = from.x + dx * along - at.x
    const ny = from.y + dy * along - at.y
    return nx * nx + ny * ny
}

/**
 * Every shot in the air.
 *
 * Its own pool rather than a ParticleField with a damage field on it: that pool
 * recycles its oldest slot when full, which for a cosmetic spark is right and
 * for a round still in flight would silently delete a shot. The discipline is
 * the same - fixed capacity, swap-retire - but a full field here drops the
 * *newest* shot instead, so nothing already fired ever vanishes.
 */
export class ProjectileField {
    readonly capacity: number

    private readonly pool: Projectile[] = []
    private live = 0

    constructor(capacity: number) {
        this.capacity = Math.max(1, Math.floor(capacity))
    }

    get count(): number {
        return this.live
    }

    forEach(visit: (projectile: Projectile) => void): void {
        for (let i = 0; i < this.live; i++) visit(this.pool[i]!)
    }

    /** Fires one shot. Ignored when the air is already full. */
    fire(shot: Shot): void {
        if (this.live >= this.capacity) return

        if (this.live === this.pool.length) this.pool.push(blank())
        const projectile = this.pool[this.live++]!

        projectile.position.x = shot.at.x
        projectile.position.y = shot.at.y
        projectile.velocity.x = shot.direction.x * shot.speed + shot.carry.x
        projectile.velocity.y = shot.direction.y * shot.speed + shot.carry.y
        projectile.damage = shot.damage
        projectile.range = shot.range
        projectile.spawnRange = shot.range
    }

    clear(): void {
        this.live = 0
    }

    /**
     * Advances every shot, resolving the first rock each one meets.
     *
     * First hit wins and the round dies there: a shot that carried on through
     * would let one autocannon round clear a whole line of rocks, and nothing
     * about a bullet says it should.
     *
     * Rocks are compared in the order given, which for overlapping rocks means
     * the earlier one takes it. A nearest-along-the-path test would be more
     * correct and needs a sort per shot per frame; with a few dozen of each, the
     * difference is invisible and the cost is not.
     */
    step(dt: number, targets: readonly Target[]): Impact[] {
        const impacts: Impact[] = []

        for (let i = this.live - 1; i >= 0; i--) {
            const projectile = this.pool[i]!
            const from = { x: projectile.position.x, y: projectile.position.y }

            const to = {
                x: from.x + projectile.velocity.x * dt,
                y: from.y + projectile.velocity.y * dt,
            }

            const travelled = Math.hypot(to.x - from.x, to.y - from.y)
            const hit = firstHit(from, to, targets)

            if (hit) {
                hit.hitPoints -= projectile.damage
                impacts.push({
                    at: to,
                    target: hit,
                    damage: projectile.damage,
                    destroyed: isDestroyed(hit),
                })
                this.retire(i)
                continue
            }

            projectile.position = to
            projectile.range -= travelled

            // Expiry is the range running out, not a lifetime: a weapon's reach is
            // the number the builder shows, and a slow shell should reach as far
            // as a fast one rather than dying halfway there
            if (projectile.range <= 0) this.retire(i)
        }

        return impacts
    }

    private retire(at: number): void {
        this.live--
        const last = this.pool[this.live]!
        this.pool[this.live] = this.pool[at]!
        this.pool[at] = last
    }
}

function firstHit(from: Vec2, to: Vec2, targets: readonly Target[]): Target | null {
    for (const target of targets) {
        if (isDestroyed(target)) continue
        if (sweptDistanceSquared(from, to, target.position) <= target.radius * target.radius) {
            return target
        }
    }

    return null
}

function blank(): Projectile {
    return {
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        damage: 0,
        range: 0,
        spawnRange: 0,
    }
}
