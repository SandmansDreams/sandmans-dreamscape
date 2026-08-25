// What a ship shoots with, and where each mount is pointing

import { approach } from "./ease"
import type { Vec2 } from "../render/camera"
import { componentById, WeaponComponent } from "../render/grid/components"
import { OFFSETS } from "../render/grid/shipLegality"
import type { ShipPhysics } from "./physics"
import type { ShipLayer } from "../render/grid/layers"
import type { Ship } from "./ship"
import { isDestroyed, type Target } from "./targets"

/**
 * How far off a turret may be and still fire, in radians.
 *
 * Not zero: a mount slewing toward a moving cursor never lands exactly on it, so
 * a strict test would leave a tracking turret silent forever.
 */
const AIM_TOLERANCE = 0.12

/** Seconds a shot takes to cross its weapon's full range. */
const SHOT_FLIGHT = 0.6

/**
 * One weapon, flattened to what firing needs.
 *
 * A snapshot rather than a live Cell, the same discipline Thruster follows: a
 * Cell is mutable and gets rebuilt with the ship, and holding one here would be
 * a dangling reference the first time a block is placed.
 */
export interface WeaponMount {
    /**
     * Which grid this came off, and where on it.
     *
     * The layer matters as much as the coordinates: a weapon sits over a hull
     * plate at the same column and row, so a lookup that searched the layers in
     * order would find the plate and never the weapon.
     */
    layer: ShipLayer
    col: number
    row: number
    /** Cells from the centre of mass, ship-local - the same frame Thruster uses. */
    offset: Vec2
    /** Radians, ship-local, from the cell's facing. Where a fixed mount points. */
    facing: number
    damage: number
    cooldown: number
    range: number
    /** Power per shot. */
    draw: number
    /** Radians per second the mount can slew. Zero means welded to its facing. */
    traverse: number
}

/**
 * How far a barrel is driven back at the moment it fires, in cells.
 *
 * Small on purpose: the kick is meant to read as the gun working, not as the
 * barrel coming loose. A quarter of a cell is plainly visible at this scale.
 */
export const RECOIL_KICK = 0.15

/**
 * What fraction of the remaining kick is left after a second.
 *
 * Exponential so it snaps back fast and then settles, which is what a recoil
 * spring does. About a 90ms half-life.
 */
const RECOIL_RECOVER = 0.0005

/**
 * The same, for the muzzle's light.
 *
 * Far faster than the recoil it accompanies, and faster again than an engine's
 * glow: a nozzle is heat that lingers, a muzzle flash is a bang. About 30ms,
 * which is a couple of frames of visible light.
 */
const FLASH_FADE = 1e-10

/** How a mount is doing right now. Parallel to the mounts array. */
export interface WeaponState {
    /** Seconds until it can fire again. */
    cooldown: number
    /** Ship-local radians. Equals the mount's facing on anything fixed. */
    angle: number
    /** Cells the barrel is currently driven back down its own line. */
    recoil: number
    /** 0..1, how brightly the muzzle is still burning from the last shot. */
    flash: number
}

/** True for a mount that can be aimed rather than pointed with the whole ship. */
export function isTurret(mount: WeaponMount): boolean {
    return mount.traverse > 0
}

/** Every weapon on the ship, in a stable order, against its physics. */
export function weaponMountsOf(ship: Ship, physics: ShipPhysics): WeaponMount[] {
    const centre = physics.center
    const mounts: WeaponMount[] = []

    for (const grid of ship.layersOf()) {
        for (const cell of grid.ofKind("weapon")) {
            const component = componentById(cell.type)
            if (!(component instanceof WeaponComponent)) continue

            const stats = component.statsAt(cell.level)
            const step = OFFSETS[cell.facing % 4]!

            mounts.push({
                layer: grid.layer,
                col: cell.col,
                row: cell.row,
                offset: { x: cell.col + 0.5 - centre.x, y: cell.row + 0.5 - centre.y },
                // The way the barrel points, which is the way the block was placed
                facing: Math.atan2(step.row, step.col),
                damage: stats.damage,
                cooldown: stats.cooldown,
                range: stats.range,
                draw: stats.draw,
                traverse: stats.traverse,
            })
        }
    }

    return mounts
}

export function freshStates(mounts: readonly WeaponMount[]): WeaponState[] {
    return mounts.map((mount) => ({ cooldown: 0, angle: mount.facing, recoil: 0, flash: 0 }))
}

/** Muzzle speed, derived so `range` stays the one knob a weapon is tuned by. */
export function shotSpeed(mount: WeaponMount): number {
    return mount.range / SHOT_FLIGHT
}

/** The shortest signed turn from `from` to `to`, in radians. */
export function angleDelta(from: number, to: number): number {
    let delta = (to - from) % (Math.PI * 2)
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2

    return delta
}

/**
 * Where a mount points after this frame, in ship-local radians.
 *
 * A turret slews toward the aim at its traverse rate and no faster, which is
 * what stops it snapping onto a cursor flicked across the screen. A fixed mount
 * ignores the aim entirely: it is welded to its facing, and pointing it is the
 * pilot's job. That is the whole difference between a railgun and a turret, and
 * it is why a railgun's placement in the builder matters.
 *
 * An unpowered turret does not move at all. What turns a barrel is the ship, so
 * a mount nothing is feeding sits exactly where it was left - which is also what
 * makes an unwired gun visibly a problem rather than a silent one.
 *
 * @param aim where the pilot is pointing, in ship-local radians
 */
export function aimOf(
    mount: WeaponMount,
    state: WeaponState,
    aim: number,
    dt: number,
    powered = true,
): number {
    if (!powered || !isTurret(mount)) return powered ? mount.facing : state.angle

    const delta = angleDelta(state.angle, aim)
    const step = mount.traverse * dt

    return Math.abs(delta) <= step ? aim : state.angle + Math.sign(delta) * step
}

/**
 * Whether a mount fires this frame.
 *
 * A turret holds until it is lined up; a fixed mount fires the moment the
 * trigger is down, because it has no way to line itself up and waiting would
 * mean it never fired at all.
 */
export function willFire(
    mount: WeaponMount,
    state: WeaponState,
    aim: number,
    triggered: boolean,
    powered: boolean,
): boolean {
    if (!triggered || !powered || state.cooldown > 0) return false
    if (!isTurret(mount)) return true

    return Math.abs(angleDelta(state.angle, aim)) <= AIM_TOLERANCE
}

/**
 * The nearest live target within reach of a point, or null.
 *
 * Squared throughout, so picking one costs no square roots: only the ordering
 * matters and squaring preserves it. Nearest rather than largest or weakest,
 * because the near one is the one about to be a problem.
 */
export function nearestInRange(
    from: Vec2,
    range: number,
    targets: readonly Target[],
): Target | null {
    let best: Target | null = null
    let bestDistance = range * range

    for (const target of targets) {
        if (isDestroyed(target)) continue

        const dx = target.position.x - from.x
        const dy = target.position.y - from.y
        // Its edge, not its centre: a big rock is in range before its middle is
        const reach = Math.max(0, Math.hypot(dx, dy) - target.radius)

        if (reach * reach <= bestDistance) {
            bestDistance = reach * reach
            best = target
        }
    }

    return best
}

/**
 * Where to point to hit something that keeps moving, in world radians.
 *
 * One round of prediction rather than solving the intercept exactly: the error
 * left over is the distance the target moves during the *correction*, which at
 * rock speeds against shot speeds is a fraction of a rock. Solving it properly
 * means a quadratic and a branch for "cannot be caught", and neither buys
 * anything you could see.
 */
export function leadAngle(from: Vec2, target: Target, speed: number): number {
    const dx = target.position.x - from.x
    const dy = target.position.y - from.y

    const flight = speed > 0 ? Math.hypot(dx, dy) / speed : 0

    return Math.atan2(
        dy + target.velocity.y * flight,
        dx + target.velocity.x * flight,
    )
}

/** Counts every mount's cooldown down, never past zero. */
export function coolDown(states: WeaponState[], dt: number): void {
    for (const state of states) state.cooldown = Math.max(0, state.cooldown - dt)
}

/**
 * Eases every barrel back to rest and lets its muzzle go dark.
 *
 * Both together because both are what firing did to a mount, and both are
 * snapped to zero once they are under a thousandth - a barrel that crept back
 * forever a subpixel at a time would keep the glow buffer busy for nothing.
 */
export function settleWeapons(states: WeaponState[], dt: number): void {
    for (const state of states) {
        state.recoil = approach(state.recoil, 0, RECOIL_RECOVER, dt)
        if (state.recoil < 0.001) state.recoil = 0

        state.flash = approach(state.flash, 0, FLASH_FADE, dt)
        if (state.flash < 0.001) state.flash = 0
    }
}
