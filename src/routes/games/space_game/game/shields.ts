// Directional shields: what they cover, and what bounces off them

import type { Vec2 } from "../render/camera"
import { componentById, ProjectorComponent } from "../render/grid/components"
import { OFFSETS } from "../render/grid/shipLegality"
import type { ShipLayer } from "../render/grid/layers"
import type { ShipPhysics } from "./physics"
import type { Ship } from "./ship"

/**
 * How wide a shield spreads, in radians.
 *
 * Ninety degrees, so one covers a quarter of the ship and a hull that wants
 * cover all round has to carry four and pay for four. A dome would make
 * placement meaningless - the whole point is that a shield faces somewhere.
 */
export const SHIELD_SPREAD = Math.PI / 2

/** One projector, flattened to what a shield needs from it. */
export interface ShieldArc {
    /** Where on the grid, for the power lookup. */
    layer: ShipLayer
    col: number
    row: number
    /** Cells from the centre of mass, ship-local - the same frame Thruster uses. */
    offset: Vec2
    /** Ship-local radians, the middle of the arc, from the block's facing. */
    facing: number
    /** Cells from the projector to the shield's face. */
    radius: number
    /** Power per second to hold it up. */
    draw: number
}

/** A shield as it stands in the world this frame. */
export interface ActiveShield {
    at: Vec2
    /** World radians. */
    facing: number
    radius: number
}

/** Every shield projector on the ship, in a stable order, against its physics. */
export function shieldArcsOf(ship: Ship, physics: ShipPhysics): ShieldArc[] {
    const centre = physics.center
    const arcs: ShieldArc[] = []

    for (const grid of ship.layersOf()) {
        for (const cell of grid.ofKind("projector")) {
            const component = componentById(cell.type)
            if (!(component instanceof ProjectorComponent)) continue

            // A radar dish is a projector too, and it projects nothing that stops
            // anything. Only the shield has a face.
            if (cell.type !== "shield-projector") continue

            const stats = component.statsAt(cell.level)
            const step = OFFSETS[cell.facing % 4]!

            arcs.push({
                layer: grid.layer,
                col: cell.col,
                row: cell.row,
                offset: { x: cell.col + 0.5 - centre.x, y: cell.row + 0.5 - centre.y },
                facing: Math.atan2(step.row, step.col),
                radius: stats.radius,
                draw: stats.draw,
            })
        }
    }

    return arcs
}

/** The shortest signed turn from `from` to `to`, in radians. */
function angleGap(from: number, to: number): number {
    let delta = (to - from) % (Math.PI * 2)
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2

    return delta
}

/**
 * True when something of this size at this point is inside the arc.
 *
 * The angle is measured to the thing's centre while the distance allows for its
 * edge, which is the honest pairing: a rock is stopped when any of it reaches
 * the face, but a rock sitting off to one side is not "in" the arc merely
 * because it is wide.
 */
export function shieldCovers(shield: ActiveShield, at: Vec2, radius = 0): boolean {
    const dx = at.x - shield.at.x
    const dy = at.y - shield.at.y
    const away = Math.hypot(dx, dy)

    if (away - radius > shield.radius) return false
    // Dead centre is inside every arc, and has no angle to test
    if (away <= 0) return true

    return Math.abs(angleGap(shield.facing, Math.atan2(dy, dx))) <= SHIELD_SPREAD / 2
}

/** What a shield did to something that ran into it, or null if it did nothing. */
export interface Deflection {
    position: Vec2
    velocity: Vec2
}

/**
 * Bounces something off a shield's face.
 *
 * Only what is moving *inward* is turned: something already inside and on its
 * way out is leaving anyway, and shoving it back in would trap it against the
 * face forever. Sitting exactly still counts as inward, so a rock nudged into
 * cover by something else does not simply rest inside it.
 *
 * The face is a surface at `radius`, so the bounce is radial: the outward
 * component of the velocity is reflected and the rest carries on along the
 * shield, which is what makes a glancing hit slide rather than stop dead.
 */
export function deflectOff(
    shield: ActiveShield,
    position: Vec2,
    velocity: Vec2,
    radius = 0,
    restitution = 1,
): Deflection | null {
    if (!shieldCovers(shield, position, radius)) return null

    const dx = position.x - shield.at.x
    const dy = position.y - shield.at.y
    const away = Math.hypot(dx, dy)
    if (away <= 0) return null

    const outX = dx / away
    const outY = dy / away

    // Closing on the face, not leaving it
    const closing = velocity.x * outX + velocity.y * outY
    if (closing > 0) return null

    const stopAt = shield.radius + radius

    return {
        position: {
            x: shield.at.x + outX * stopAt,
            y: shield.at.y + outY * stopAt,
        },
        velocity: {
            x: velocity.x - (1 + restitution) * closing * outX,
            y: velocity.y - (1 + restitution) * closing * outY,
        },
    }
}

/** How far a node drifts in and out of the face, in cells. */
export const SHIELD_JITTER = 0.13

/** How fast that drift cycles, in radians a second. */
const SHIELD_SHIMMER = 5.5

/**
 * Phase between one node and its neighbour.
 *
 * The golden angle, so the shimmer never lines up into bands travelling along
 * the arc. Any round fraction of a turn gives a visible pattern; this one is as
 * far from every round fraction as a number can be.
 */
const NODE_PHASE = 2.399963

/**
 * Where one node of a shield sits this instant, in world cells.
 *
 * A field of nodes rather than a solid band: a shield is something being held,
 * and the small constant motion is what says it is being held *now* rather than
 * bolted on. Driven by a sine of the clock rather than by random numbers, so it
 * shimmers rather than seethes - and so it is the same on every machine and can
 * be tested at all.
 */
export function shieldNode(
    shield: ActiveShield,
    index: number,
    count: number,
    time: number,
): Vec2 {
    // Spread across the arc inclusive of both ends, so the face reaches its own
    // edges rather than stopping a node short of them
    const across = count > 1 ? index / (count - 1) : 0.5
    const angle = shield.facing + (across - 0.5) * SHIELD_SPREAD

    const away = shield.radius
        + Math.sin(time * SHIELD_SHIMMER + index * NODE_PHASE) * SHIELD_JITTER

    return {
        x: shield.at.x + Math.cos(angle) * away,
        y: shield.at.y + Math.sin(angle) * away,
    }
}
