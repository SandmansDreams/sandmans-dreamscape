// Rigid-body motion for a ship, derived entirely from the blocks it is built from

import type { Vec2 } from "../../../render/camera"
import type { Cell } from "../../../render/grid/grid"
import { OFFSETS } from "../../../render/grid/shipLegality"
import type { Ship } from "./ship"
import {
    CargoComponent,
    componentById,
    TankComponent,
    ThrusterComponent,
} from "../../../render/grid/components"

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

/**
 * Keeps a hull where it looks like it is when its center of mass moves.
 *
 * A cell is drawn at `position + rotate(cellPos - center)`, so moving `center` by
 * D moves every cell by `-rotate(D)`. Adding `rotate(D)` back to the position
 * holds them still - and is also what is physically true, since the body tracks
 * the center of mass and the new center genuinely is at that world point.
 *
 * Wanted twice: a destroyed block walks the center, and so does a tank crossing a
 * load stage. Both teleport the ship without this.
 */
export function recenter(body: Body, from: Vec2, to: Vec2): Body {
    const dx = to.x - from.x
    const dy = to.y - from.y
    if (dx === 0 && dy === 0) return body

    const cos = Math.cos(body.angle)
    const sin = Math.sin(body.angle)

    return {
        ...body,
        position: {
            x: body.position.x + dx * cos - dy * sin,
            y: body.position.y + dx * sin + dy * cos,
        },
    }
}

/**
 * How many steps a fill is rounded to before it moves the ship's mass.
 *
 * Ten rather than a continuous fraction because mass feeds the centre of mass,
 * the inertia and every thruster's leverage: a value that moved every frame would
 * rebuild all of that every frame. A tank draining over three minutes crosses a
 * boundary about once every twenty seconds instead, which is free.
 */
export const LOAD_STAGES = 10

/** How full a ship is, quantised. Pairs with ship.revision as a cache key. */
export interface LoadStages {
    /** 0..LOAD_STAGES. */
    fuel: number
    cargo: number
}

/** Empty tanks and an empty hold - the dry ship the builder totals. */
export const DRY: LoadStages = { fuel: 0, cargo: 0 }

/** Brimming, for the builder's loaded centre-of-mass marker. */
export const FULL: LoadStages = { fuel: LOAD_STAGES, cargo: LOAD_STAGES }

/**
 * Which of LOAD_STAGES steps a fill sits on.
 *
 * Rounded rather than floored so a full tank reads full and an empty one reads
 * empty, with the error symmetric at half a step either way. No hysteresis, and
 * none is wanted: fuel only ever falls, so a stage cannot oscillate across a
 * boundary the way something that could rise again would.
 */
export function loadStage(stored: number, capacity: number): number {
    if (capacity <= 0) return 0

    const fraction = Math.min(Math.max(stored / capacity, 0), 1)
    return Math.round(fraction * LOAD_STAGES)
}

/** One engine, reduced to what Newton needs from it and where it sits. */
export interface Thruster {
    /** Force on the ship at full throttle, in ship-local space. */
    force: Vec2
    /** Torque about the center of mass. Signed, so the direction is in the number. */
    torque: number
    /** True when the builder marked this engine as one the pilot steers with. */
    steering: boolean
    /**
     * Where the engine sits, in cells from the center of mass, in ship-local space.
     *
     * Newton has no use for it - the torque above already carries the leverage -
     * but anything drawing the engine does: exhaust has to leave from the nozzle
     * rather than from the middle of the ship.
     */
    offset: Vec2
    /**
     * Where the engine sits on the grid.
     *
     * The back-reference to the cell this came from, so the power network can be
     * asked whether anything is feeding this engine. `offset` cannot answer that:
     * it is relative to a centre of mass that moves as the tanks drain.
     */
    col: number
    row: number
    /** Power per second at full throttle, in proportion below that. */
    draw: number
}

/** What an engine pushes with, and what running it costs. */
export interface ThrusterRating {
    thrust: number
    draw: number
}

/**
 * Everything about a ship that only changes when its blocks do.
 *
 * Built once and cached by the caller against the ship's revision *and* its load
 * stages: a step needs all of it, and none of it depends on where the ship
 * currently is.
 */
export interface ShipPhysics {
    mass: number
    /** The point the ship rotates about, in cells. */
    center: Vec2
    /** Resistance to being spun, about that point. */
    inertia: number
    thrusters: readonly Thruster[]
}

/** A cell that weighs something, and what it weighs with its load aboard. */
interface LoadedCell {
    cell: Cell
    mass: number
}

/**
 * What a cell weighs with its share of the load in it.
 *
 * Dry mass plus the fraction of a full load its stage says is aboard. Tanks and
 * crates read different stages because they hold different things; everything
 * else is simply itself. Cosmetics arrive as mass 0 from Grid.set, so they stay
 * weightless here without this needing to know layers exist.
 */
function loadedMass(cell: Cell, load: LoadStages): number {
    if (cell.mass <= 0) return 0

    const component = componentById(cell.type)
    const holds = component instanceof TankComponent || component instanceof CargoComponent
    if (!holds) return cell.mass

    const stage = component instanceof TankComponent ? load.fuel : load.cargo
    return cell.mass + component.statsAt(cell.level).loadMass * (stage / LOAD_STAGES)
}

function loadedCells(ship: Ship, load: LoadStages): LoadedCell[] {
    const out: LoadedCell[] = []

    for (const grid of ship.layersOf()) {
        for (const cell of grid.list) {
            const mass = loadedMass(cell, load)
            if (mass > 0) out.push({ cell, mass })
        }
    }

    return out
}

/**
 * Everything about a ship that only changes when its blocks or its load do.
 *
 * Mass and centre are derived here rather than read off the ship, because
 * `ship.mass` and `ship.centerOfMass` are dry by definition: a Grid sums the mass
 * a block was built with and knows nothing about what is in the tanks. The builder
 * wants that dry figure. What actually flies is this one, and a nose tank draining
 * really does walk the centre of mass aft.
 */
export function shipPhysics(ship: Ship, load: LoadStages): ShipPhysics {
    const loaded = loadedCells(ship, load)

    let mass = 0
    let x = 0
    let y = 0

    for (const { cell, mass: cellMass } of loaded) {
        mass += cellMass
        // Cell centers, not corners: a cell at column 0 spans 0 to 1
        x += (cell.col + 0.5) * cellMass
        y += (cell.row + 0.5) * cellMass
    }

    const center = mass > 0 ? { x: x / mass, y: y / mass } : { x: 0, y: 0 }
    let inertia = 0

    for (const { cell, mass: cellMass } of loaded) {
        const dx = cell.col + 0.5 - center.x
        const dy = cell.row + 0.5 - center.y

        // mass/6 is a unit square's own inertia about its center - m(w²+h²)/12
        // with w = h = 1. Not a refinement: without it a one-cell ship has no
        // inertia at all, and dividing torque by zero is not a rounding problem.
        inertia += cellMass / 6 + cellMass * (dx * dx + dy * dy)
    }

    return { mass, center, inertia, thrusters: thrustersOf(ship, center) }
}

/** What a cell pushes with and costs, or null for anything that is not a thruster. */
function thrustOf(cell: Cell): ThrusterRating | null {
    const component = componentById(cell.type)

    // The concrete class, because statsFor only promises the stats every component
    // has and thrust is the thruster's own
    if (!(component instanceof ThrusterComponent)) return null

    const stats = component.statsAt(cell.level)
    return { thrust: stats.thrust, draw: stats.draw }
}

/**
 * One engine, from the cell that is it.
 *
 * Exported because the builder needs to know which way a nozzle would turn the
 * ship in order to mark it, and deriving that a second time is how a marker ends
 * up disagreeing with the physics it is describing.
 */
export function thrusterOf(cell: Cell, center: Vec2, rating: ThrusterRating): Thruster {
    // Exhaust leaves the way the thruster points, so the ship goes the other way
    const step = OFFSETS[cell.facing % 4]!
    const force = { x: -step.col * rating.thrust, y: -step.row * rating.thrust }

    const rx = cell.col + 0.5 - center.x
    const ry = cell.row + 0.5 - center.y

    return {
        force,
        // The 2D cross product r × F. This single line is why placement matters:
        // a thruster through the center contributes nothing here.
        torque: rx * force.y - ry * force.x,
        steering: cell.steering,
        offset: { x: rx, y: ry },
        col: cell.col,
        row: cell.row,
        draw: rating.draw,
    }
}

/**
 * Which way an engine at this cell turns the ship: -1 left, 1 right, 0 not at all.
 *
 * The sign the allocator matches against `Controls.turn`, so a marker built on it
 * says exactly what Q and E will do.
 */
export function turnSignOf(cell: Cell, center: Vec2): number {
    // thrust 1 because only the sign is wanted, and it scales the torque without
    // moving it off zero. draw 0 because this asks a geometric question about
    // leverage, not one about what the engine would cost to run.
    return Math.sign(thrusterOf(cell, center, { thrust: 1, draw: 0 }).torque)
}

function thrustersOf(ship: Ship, center: Vec2): Thruster[] {
    const out: Thruster[] = []

    for (const grid of ship.layersOf()) {
        for (const cell of grid.ofKind("thruster")) {
            const rating = thrustOf(cell)
            if (rating === null || rating.thrust <= 0) continue

            out.push(thrusterOf(cell, center, rating))
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
 * True when an engine pushes against an axis the pilot asked for.
 *
 * Not the negation of pushesToward: an engine doing nothing on either axis
 * neither helps nor fights, so both questions answer false for it.
 */
function fightsAgainst(force: Vec2, move: Vec2): boolean {
    return force.x * move.x < 0 || force.y * move.y < 0
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
        // An engine that undoes the burn is not stabilising it. Assist steadies
        // the ship the pilot is flying, not one fighting its own strafe.
        if (fightsAgainst(thruster.force, controls.move)) continue
        if (Math.sign(thruster.torque) === wanted) available += Math.abs(thruster.torque)
    }

    if (available === 0) return firing

    // Capped at 1: past that the engines simply cannot stop the spin this frame,
    // and without it a hard spin would overshoot into one the other way
    const share = Math.min(Math.abs(needed) / available, 1)

    physics.thrusters.forEach((thruster, index) => {
        if (!thruster.steering || fightsAgainst(thruster.force, controls.move)) return
        if (Math.sign(thruster.torque) !== wanted) return
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
 *
 * Takes the throttles rather than the controls, because the caller needs them
 * too: the exhaust and the engine glow are drawn from the same numbers. Working
 * them out here as well is how a plume ends up claiming a thrust the ship never
 * made - which stops being theoretical the moment power gating can scale them
 * back before they get here.
 */
export function step(body: Body, physics: ShipPhysics, firing: readonly number[], dt: number): Body {
    // A ship with no mass is a ship with no blocks; nothing to push and nothing
    // to divide by
    if (physics.mass <= 0 || physics.inertia <= 0) return body



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
