// Short-lived specks with no physics beyond drift and a fade. Cells and seconds.

import type { Vec2 } from "../render/camera"

/**
 * One speck.
 *
 * Plain and mutable, because a field of them is stepped in place every frame and
 * returning a new object per particle per frame is the one allocation this file
 * exists to avoid.
 */
export interface Particle {
    position: Vec2
    velocity: Vec2
    /** Seconds left to live. At or below zero it is gone. */
    life: number
    /** Seconds it began with, so a fade can be a fraction rather than a guess. */
    lifespan: number
    /** Radius in cells at birth. */
    size: number
    red: number
    green: number
    blue: number
}

/** What to spawn. Every spread is symmetric: the value is the half-width. */
export interface Emission {
    /** Where, in cells. */
    at: Vec2
    /** Which way the specks leave, as a unit vector. */
    direction: Vec2
    /** Cells per second along `direction`. */
    speed: number
    /** Added to every particle, for exhaust that inherits the ship's motion. */
    drift?: Vec2
    /** Radians of cone half-angle. 0 fires a straight line. */
    spread?: number
    /** Fraction of `speed` the speed itself varies by, 0..1. */
    speedJitter?: number
    life: number
    /** Fraction of `life` that lifetime varies by, 0..1. */
    lifeJitter?: number
    size: number
    red: number
    green: number
    blue: number
}

/** How bright a particle is now, 1 at birth and 0 as it dies. */
export function fadeOf(particle: Particle): number {
    return particle.lifespan <= 0 ? 0 : Math.max(0, particle.life / particle.lifespan)
}

/**
 * A fixed pool of particles.
 *
 * Fixed rather than growing, because the cost of a particle system is supposed
 * to be knowable: a field that can hold 2000 costs 2000 whatever the pilot does
 * with the throttle. When it is full the oldest speck is recycled, which is the
 * one nobody will miss.
 *
 * Order is not meaningful - the dead are removed by swapping the last live one
 * into the gap, which is O(1) and safe precisely because these draw additively
 * and so do not need sorting.
 */
export class ParticleField {
    readonly capacity: number

    /**
     * The random source, injected so a test can hand over a sequence it chose.
     *
     * Every jitter below runs through this. A field built with `() => 0.5` emits
     * dead down the middle of its cone at exactly the speed asked for, which is
     * what makes the emission geometry testable at all.
     */
    private readonly random: () => number

    private readonly pool: Particle[] = []
    private live = 0

    constructor(capacity: number, random: () => number = Math.random) {
        this.capacity = Math.max(1, Math.floor(capacity))
        this.random = random
    }

    get count(): number {
        return this.live
    }

    /** Every living particle, oldest-first only by accident. Do not hold on to one. */
    forEach(visit: (particle: Particle) => void): void {
        for (let i = 0; i < this.live; i++) visit(this.pool[i]!)
    }

    /** Spawns `count` particles. Silently emits fewer than asked only if count < 1. */
    emit(count: number, spec: Emission): void {
        for (let i = 0; i < Math.floor(count); i++) this.emitOne(spec)
    }

    /**
     * Ages every particle and moves it.
     *
     * No drag and no gravity: these are sparks in vacuum, and the fade is what
     * makes them stop being interesting rather than a force that slows them.
     */
    update(dt: number): void {
        let i = 0

        while (i < this.live) {
            const particle = this.pool[i]!
            particle.life -= dt

            if (particle.life <= 0) {
                this.retire(i)
                // No i++ - the swap put an unvisited particle at this index
                continue
            }

            particle.position.x += particle.velocity.x * dt
            particle.position.y += particle.velocity.y * dt
            i++
        }
    }

    clear(): void {
        this.live = 0
    }

    /**
     * A signed value in -amount..amount, from the injected source.
     *
     * Draws nothing at all when there is nothing to vary. Otherwise turning a
     * spread on would shift every later jitter by one number in the sequence,
     * which makes one setting quietly change the others.
     */
    private jitter(amount: number): number {
        if (amount === 0) return 0

        return (this.random() * 2 - 1) * amount
    }

    private emitOne(spec: Emission): void {
        const angle = Math.atan2(spec.direction.y, spec.direction.x) + this.jitter(spec.spread ?? 0)
        const speed = spec.speed * (1 + this.jitter(spec.speedJitter ?? 0))
        const life = spec.life * (1 + this.jitter(spec.lifeJitter ?? 0))

        const drift = spec.drift
        const particle = this.claim()

        particle.position.x = spec.at.x
        particle.position.y = spec.at.y
        particle.velocity.x = Math.cos(angle) * speed + (drift?.x ?? 0)
        particle.velocity.y = Math.sin(angle) * speed + (drift?.y ?? 0)

        // Floored above zero: a particle born dead would draw for one frame and
        // then vanish, which reads as a flicker rather than as a spark
        particle.life = Math.max(life, 1e-4)
        particle.lifespan = particle.life
        particle.size = spec.size
        particle.red = spec.red
        particle.green = spec.green
        particle.blue = spec.blue
    }

    /**
     * The particle to write the next emission into.
     *
     * Grows the pool up to capacity, then recycles slot 0 - the oldest, since
     * emission appends and death swaps from the end.
     */
    private claim(): Particle {
        if (this.live < this.capacity) {
            if (this.live === this.pool.length) this.pool.push(blank())
            return this.pool[this.live++]!
        }

        const oldest = this.pool[0]!
        this.retire(0)
        this.pool[this.live++] = oldest
        return oldest
    }

    /** Removes index `at` by swapping the last live particle into its place. */
    private retire(at: number): void {
        this.live--
        const last = this.pool[this.live]!
        this.pool[this.live] = this.pool[at]!
        this.pool[at] = last
    }
}

function blank(): Particle {
    return {
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        life: 0,
        lifespan: 0,
        size: 0,
        red: 1,
        green: 1,
        blue: 1,
    }
}
