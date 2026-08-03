import { Grid, type RGB } from "./grid"

/**
 * A hand-built hull, used to prove the grid and tessellator work together
 * before there is an editor to draw one.
 *
 * Authored nose-up: row 0 is the front, increasing rows run aft.
 *
 * Orientation reference, since the canonical forms are easy to misremember:
 *
 *   arc        turns 0-3 bite out of  SE, SW, NW, NE
 *   wedge      turns 0-3 solid corner NW, NE, SE, SW
 *   half       turns 0-3 fill         N,  E,  S,  W
 *   halfWedge  turns 0-3 sit on edge  N,  E,  S,  W
 *              with the thick end at  W,  N,  E,  S
 */

const HULL: RGB = [0.55, 0.60, 0.68]
const HULL_DARK: RGB = [0.40, 0.45, 0.53]
const COCKPIT: RGB = [0.29, 0.62, 1.00]
const ACCENT: RGB = [0.88, 0.44, 0.19]
const ENGINE: RGB = [0.78, 0.31, 0.16]

export function buildDemoShip(): Grid {
    const grid = new Grid()

    // Nose: round off the two outer front corners so the tip is blunt.
    grid.set(2, 0, "arc", { turns: 2, color: HULL_DARK })   // bite out of NW
    grid.set(3, 0, "arc", { turns: 3, color: HULL_DARK })   // bite out of NE

    grid.fill(2, 1, 3, 1, "full", { color: COCKPIT })

    // Shoulders: hull widens from two cells to four.
    grid.set(1, 2, "wedge", { turns: 2, color: HULL_DARK })   // solid SE
    grid.fill(2, 2, 3, 2, "full", { color: HULL })
    grid.set(4, 2, "wedge", { turns: 3, color: HULL_DARK })   // solid SW

    grid.fill(1, 3, 4, 3, "full", { color: HULL })

    // Wings. Shallow ramps sweep the leading edge back; the mirrored pair is
    // what four rotations alone could not produce.
    grid.set(0, 4, "halfWedge", { turns: 2, color: ACCENT })                    // thick east
    grid.set(5, 4, "halfWedge", { turns: 2, mirrored: true, color: ACCENT })    // thick west
    grid.set(1, 4, "full", { color: ACCENT })
    grid.fill(2, 4, 3, 4, "full", { color: HULL })
    grid.set(4, 4, "full", { color: ACCENT })

    grid.set(0, 5, "wedge", { turns: 1, color: ACCENT })   // solid NE
    grid.set(1, 5, "full", { color: HULL_DARK })
    grid.fill(2, 5, 3, 5, "full", { color: HULL })
    grid.set(4, 5, "full", { color: HULL_DARK })
    grid.set(5, 5, "wedge", { turns: 0, color: ACCENT })   // solid NW

    // Aft taper back down to two cells.
    grid.set(1, 6, "wedge", { turns: 1, color: HULL_DARK })   // solid NE
    grid.fill(2, 6, 3, 6, "full", { color: HULL })
    grid.set(4, 6, "wedge", { turns: 0, color: HULL_DARK })   // solid NW

    // Engine block and nozzle stubs.
    grid.fill(2, 7, 3, 7, "full", { color: ENGINE })
    grid.fill(2, 8, 3, 8, "half", { turns: 0, color: ACCENT })   // flush to the top

    return grid
}
