// Rigid-body motion for a ship, derived entirely from the blocks it is built from

import type { Vec2 } from "../render/camera"
import { componentById, ThrusterComponent } from "../render/grid/components"
import type { Cell } from "../render/grid/grid"
import { OFFSETS } from "../render/grid/shipLegality"
import type { Ship } from "./ship"

/**
 * Below this, a spin is not worth chasing.
 *
 * Assist fires real engines, so steadying a millionth of a radian would push the
 * ship sideways forever in exchange for nothing.
 */
const SPIN_EPSILON = 1e-4

/** Where a ship is and how it is moving. Cells and seconds throughout. */
export interface Body {
    position: Vec2
    velocity: Vec2
    /** Radians. 0 points the ship's own north at world north. */
    angle: number
    /** Radians per second. */
    spin: number
}

export function bodyAt(x: number, y: number): Body {
    return { position: { x, y }, velocity: { x: 0, y: 0 }, angle: 0, spin: 0 }
}

/** One engine, reduced to the two numbers Newton needs from it. */
export interface Thruster {
    /** Force on the ship at full throttle, in ship-local space. */
    force: Vec2
    /** Torque about the center of mass. Signed, so the direction is in the number. */
    torque: number
    /** True when the builder marked this engine as one the pilot steers with. */
    steering: boolean
}

/**
 * Everything about a ship that only changes when its blocks do.
 *
 * Built once and cached against `geometryRevision` by the caller: a step needs all
 * of it and none of it depends on where the ship currently is.
 */
export interface ShipPhysics {
    mass: number
    /** The point the ship rotates about, in cells. */
    center: Vec2
    /** Resistance to being spun, about that point. */
    inertia: number
    thrusters: readonly Thruster[]
}

export function shipPhysics(ship: Ship): ShipPhysics {
    const center = ship.centerOfMass
    let inertia = 0

    for (const grid of ship.layersOf()) {
        for (const cell of grid.list) {
            if (cell.mass <= 0) continue

            const dx = cell.col + 0.5 - center.x
            const dy = cell.row + 0.5 - center.y

            // mass/6 is a unit square's own inertia about its center - m(w²+h²)/12
            // with w = h = 1. Not a refinement: without it a one-cell ship has no
            // inertia at all, and dividing torque by zero is not a rounding problem.
            inertia += cell.mass / 6 + cell.mass * (dx * dx + dy * dy)
        }
    }

    return { mass: ship.mass, center, inertia, thrusters: thrustersOf(ship, center) }
}

/** A thruster's push at its level, or 0 for anything that is not one. */
function thrustOf(cell: Cell): number {
    const component = componentById(cell.type)

    // The concrete class, because statsFor only promises the stats every component
    // has and thrust is the thruster's own
    return component instanceof ThrusterComponent ? component.statsAt(cell.level).thrust : 0
}

function thrustersOf(ship: Ship, center: Vec2): Thruster[] {
    const out: Thruster[] = []

    for (const grid of ship.layersOf()) {
        for (const cell of grid.ofKind("thruster")) {
            const thrust = thrustOf(cell)
            if (thrust <= 0) continue

            // Exhaust leaves the way the thruster points, so the ship goes the
            // other way
            const step = OFFSETS[cell.facing % 4]!
            const force = { x: -step.col * thrust, y: -step.row * thrust }

            const rx = cell.col + 0.5 - center.x
            const ry = cell.row + 0.5 - center.y

            // The 2D cross product r × F. This single line is why placement
            // matters: a thruster through the center contributes nothing here.
            out.push({ 
                force, 
                torque: rx * force.y - ry * force.x,
                steering: cell.steering,
            })
        }
    }

    return out
}

/** What the pilot is asking for this frame. */
export interface Controls {
    /** Desired direction of travel, in ship-local space. Zero asks for nothing. */
    move: Vec2
    /** -1, 0 or 1. Which way to rotate. */
    turn: number
    assist: boolean
}

/**
 * True when an engine pushes along an axis the pilot actually asked for.
 *
 * Per axis rather than a dot product of the whole vector: a dot mixes the two
 * into one number, so a hard push the wrong way on x can be outvoted by a soft
 * one the right way on y. Axis by axis is the rule as stated - press D and every
 * engine pointing west lights up - and when those engines sit off the center of
 * mass the ship turns while it slides. That is the ship the player built, not a
 * fault to be corrected.
 */
function pushesToward(force: Vec2, move: Vec2): boolean {
    return force.x * move.x > 0 || force.y * move.y > 0
}

/**
 * How hard each thruster fires, 0..1, in the order `thrusters` gives them.
 *
 * One rule for every input: an engine is on when it helps and off when it fights.
 * No solver and no per-thruster binding, and it degrades honestly - a ship with
 * nothing off-axis never satisfies the rotation test, so it never turns.
 */
export function throttles(
    physics: ShipPhysics,
    controls: Controls,
    spin: number,
    dt: number,
): number[] {
    // Annotated, because the ternary below infers 0 | 1 and assist needs the
    // range between them - a thruster only part-firing is how a spin is nulled
    // without overshooting into one the other way
    const firing: number[] = physics.thrusters.map((thruster) => {
        const pushes = pushesToward(thruster.force, controls.move)
        // Only the engines marked for it. A main drive mounted a little off
        // center would otherwise swing the whole ship every time you tapped Q,
        // which is the thing the builder flag exists to stop
        const turns = controls.turn !== 0
            && thruster.steering
            && Math.sign(thruster.torque) === controls.turn

        return pushes || turns ? 1 : 0
    })
    // Assist steadies only what the pilot is not steering, and only ever fires
    // engines the ship actually has - a hull with nothing off-axis gets nothing,
    // which is the same rule as above rather than an exception to it
    const steering = controls.turn !== 0
    if (!controls.assist || steering || Math.abs(spin) < SPIN_EPSILON || dt <= 0) return firing

    const needed = (-spin * physics.inertia) / dt
    const wanted = Math.sign(needed)

    let available = 0
    for (const thruster of physics.thrusters) {
        if (!thruster.steering) continue
        if (Math.sign(thruster.torque) === wanted) available += Math.abs(thruster.torque)
    }

    if (available === 0) return firing

    // Capped at 1: past that the engines simply cannot stop the spin this frame,
    // and without it a hard spin would overshoot into one the other way
    const share = Math.min(Math.abs(needed) / available, 1)

    physics.thrusters.forEach((thruster, index) => {
        if (!thruster.steering || Math.sign(thruster.torque) !== wanted) return
        firing[index] = Math.max(firing[index]!, share)
    })

    return firing
}

/**
 * One tick of motion. Returns the new body; the old one is untouched.
 *
 * Semi-implicit Euler - velocity before position - which stays stable at the
 * variable dt a browser hands out. No drag: this is space, and a spin persists
 * until something opposes it.
 */
export function step(body: Body, physics: ShipPhysics, controls: Controls, dt: number): Body {
    // A ship with no mass is a ship with no blocks; nothing to push and nothing
    // to divide by
    if (physics.mass <= 0 || physics.inertia <= 0) return body

    const firing = throttles(physics, controls, body.spin, dt)

    let fx = 0
    let fy = 0
    let torque = 0

    physics.thrusters.forEach((thruster, index) => {
        const throttle = firing[index]!
        if (throttle === 0) return

        fx += thruster.force.x * throttle
        fy += thruster.force.y * throttle
        torque += thruster.torque * throttle
    })

    // Local to world once on the total, rather than per thruster
    const cos = Math.cos(body.angle)
    const sin = Math.sin(body.angle)
    const ax = (fx * cos - fy * sin) / physics.mass
    const ay = (fx * sin + fy * cos) / physics.mass

    const velocity = { x: body.velocity.x + ax * dt, y: body.velocity.y + ay * dt }
    const spin = body.spin + (torque / physics.inertia) * dt

    return {
        velocity,
        position: {
            x: body.position.x + velocity.x * dt,
            y: body.position.y + velocity.y * dt,
        },
        spin,
        angle: body.angle + spin * dt,
    }
}

/** The box a ship is flying inside, in cells. */
export interface Arena {
    minX: number
    minY: number
    maxX: number
    maxY: number
}

/**
 * How far the ship reaches from the point it rotates about.
 *
 * A circle rather than the hull's real outline: it is rotation-invariant, so it
 * survives the ship turning without being recomputed, and "bumped into the wall"
 * looks the same either way. The cost is a gap at the corners of a long ship,
 * which is the trade every bounding volume makes.
 *
 * Cosmetics count here even though they weigh nothing - they are still hull you
 * can see hitting the wall.
 */
export function boundingRadius(ship: Ship): number {
    const center = ship.centerOfMass
    let furthest = 0

    for (const grid of ship.layersOf()) {
        for (const cell of grid.list) {
            // Corners, not centers: a cell reaches half a unit past its middle
            const dx = Math.max(Math.abs(cell.col - center.x), Math.abs(cell.col + 1 - center.x))
            const dy = Math.max(Math.abs(cell.row - center.y), Math.abs(cell.row + 1 - center.y))

            furthest = Math.max(furthest, Math.hypot(dx, dy))
        }
    }

    return furthest
}

/**
 * Keeps the ship inside the arena, bouncing off whatever it reaches.
 *
 * The position is clamped rather than resolved over time: at speed a single frame
 * can carry the ship well past a wall, and putting it back on the surface is both
 * stable and what a bump looks like.
 *
 * `restitution` is how much speed survives - 0 stops dead, 1 bounces forever.
 * Spin is deliberately untouched: a bounding circle always touches along the line
 * through its own center, so there is no lever arm to turn the ship with. A hull
 * that collided on its real outline would spin, and would need a contact point to
 * do it from.
 */
export function bounce(body: Body, radius: number, arena: Arena, restitution: number): Body {
    const position = { ...body.position }
    const velocity = { ...body.velocity }

    const left = arena.minX + radius
    const right = arena.maxX - radius
    const top = arena.minY + radius
    const bottom = arena.maxY - radius

    // An arena narrower than the ship would leave the two walls fighting over it
    // every frame, so park it between them instead
    if (left > right) {
        position.x = (arena.minX + arena.maxX) / 2
        velocity.x = 0
    } else if (position.x < left) {
        position.x = left
        velocity.x = Math.abs(velocity.x) * restitution
    } else if (position.x > right) {
        position.x = right
        velocity.x = -Math.abs(velocity.x) * restitution
    }

    if (top > bottom) {
        position.y = (arena.minY + arena.maxY) / 2
        velocity.y = 0
    } else if (position.y < top) {
        position.y = top
        velocity.y = Math.abs(velocity.y) * restitution
    } else if (position.y > bottom) {
        position.y = bottom
        velocity.y = -Math.abs(velocity.y) * restitution
    }

    return { ...body, position, velocity }
}