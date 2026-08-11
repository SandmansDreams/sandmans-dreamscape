import type { RGB } from "../../render/mesh"
import { Ship } from "../../game/ship"
import { RAMP_ON, WEDGE_SOLID } from "../../render/grid/shapes"

const PLATE: RGB = [0.58, 0.63, 0.70]
const DARK: RGB = [0.26, 0.29, 0.34]
const GLOW: RGB = [0.35, 0.85, 1.00]

/*
 * The world is y-DOWN, so the nose points north: forward is -row.
 * The origin is wherever these coordinates say it is - authoring in code means
 * the origin is explicit rather than something the file has to declare.
 */
function build(): Ship {
    const ship = new Ship("scythe", "Scythe")
    const { hull, coverable, cosmetic, placement } = ship.layers

    // Fuselage
    hull.fill(-1, -4, 1, 3, "full", { color: PLATE })

    // Nose: a single tip cell with a wedge shoulder either side, each keeping its
    // right angle on the inboard corner so the taper reads as an arrow
    hull.set(0, -5, "full", { color: PLATE })
    hull.set(-1, -5, "wedge", { turns: WEDGE_SOLID.SE, color: PLATE })
    hull.set(1, -5, "wedge", { turns: WEDGE_SOLID.SW, color: PLATE })

    // Wings
    hull.fill(-3, -1, -2, 0, "full", { color: PLATE })
    hull.fill(2, -1, 3, 0, "full", { color: PLATE })

    // Swept leading edges and clipped trailing tips
    hull.set(-3, -2, "wedge", { turns: WEDGE_SOLID.SE, color: PLATE })
    hull.set(3, -2, "wedge", { turns: WEDGE_SOLID.SW, color: PLATE })
    hull.set(-3, 1, "wedge", { turns: WEDGE_SOLID.NE, color: PLATE })
    hull.set(3, 1, "wedge", { turns: WEDGE_SOLID.NW, color: PLATE })

    // Tail
    hull.fill(-2, 3, 2, 3, "full", { color: DARK })

    // Thrusters point at the rear edge they sit against. `facing` rather than
    // `turns` because turns is folded by the shape's symmetry, and a symmetric
    // shape would silently erase the direction.
    coverable.set(-1, 4, "full", { facing: RAMP_ON.S, kind: "thruster", color: DARK, emission: 0.8 })
    coverable.set(1, 4, "full", { facing: RAMP_ON.S, kind: "thruster", color: DARK, emission: 0.8 })

    // A generator amidships, coverable so hull may sit over it
    coverable.set(0, 1, "full", { kind: "generator", color: DARK })

    // Wing-mounted guns
    placement.set(-2, -1, "band", { facing: RAMP_ON.N, kind: "weapon", color: DARK })
    placement.set(2, -1, "band", { facing: RAMP_ON.N, kind: "weapon", color: DARK })

    // Free and weightless - a stripe down the spine
    cosmetic.fill(0, -3, 0, 2, "centerLine", { turns: 1, color: GLOW, emission: 1 })

    return ship
}

export default build