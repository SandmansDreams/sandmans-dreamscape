import { Grid } from "../../grid"
import type { BlockShape } from "../../shapes"

/**
 * The default player hull.
 *
 * This used to live on Grid as `paintTestShape`, which meant the generic grid
 * container knew about cockpits and exhaust nozzles. Ship layouts belong here
 * next to the other models.
 */

const HULL = "#8a9ba8"
const HULL_DARK = "#6b7d8a"
const COCKPIT = "#4a9eff"
const COCKPIT_GLOW = "#6ab4ff"
const ACCENT = "#e07030"
const ENGINE = "#c85028"
const EXHAUST = "#ff9944"

export function buildStarterHull(): Grid {
    const grid = new Grid()

    const set = (row: number, col: number, shape: BlockShape, color: string = HULL) => {
        grid.setCell(grid.getCell(col, row), shape, color, null)
    }

    const fill = (row: number, colFrom: number, colTo: number, color: string = HULL) => {
        for (let c = colFrom; c <= colTo; c++) set(row, c, "full", color)
    }

    // Even-width ship, symmetric around the line between columns 4 and 5.

    // Nose
    set(0, 4, "full", HULL_DARK)
    set(0, 5, "full", HULL_DARK)

    // Nose widens
    set(1, 3, "triSE", HULL_DARK)
    set(1, 4, "full", COCKPIT_GLOW)
    set(1, 5, "full", COCKPIT_GLOW)
    set(1, 6, "triSW", HULL_DARK)

    // Cockpit
    set(2, 3, "full", HULL_DARK)
    set(2, 4, "full", COCKPIT)
    set(2, 5, "full", COCKPIT)
    set(2, 6, "full", HULL_DARK)

    // Body widens
    set(3, 2, "triSE", HULL)
    fill(3, 3, 6)
    set(3, 7, "triSW", HULL)

    // Main body
    for (let r = 4; r <= 5; r++) {
        set(r, 2, "full", HULL)
        set(r, 3, "full", ACCENT)
        fill(r, 4, 5, HULL)
        set(r, 6, "full", ACCENT)
        set(r, 7, "full", HULL)
    }

    // Wings expand
    set(6, 1, "triSE", ACCENT)
    set(6, 2, "full", ACCENT)
    fill(6, 3, 6, HULL)
    set(6, 7, "full", ACCENT)
    set(6, 8, "triSW", ACCENT)

    // Wings full
    set(7, 1, "full", ACCENT)
    set(7, 2, "full", ACCENT)
    fill(7, 3, 6, HULL_DARK)
    set(7, 7, "full", ACCENT)
    set(7, 8, "full", ACCENT)

    // Wings taper
    set(8, 1, "triNE", ACCENT)
    set(8, 2, "full", ACCENT)
    fill(8, 3, 6, HULL)
    set(8, 7, "full", ACCENT)
    set(8, 8, "triNW", ACCENT)

    // Lower body
    for (let r = 9; r <= 10; r++) {
        set(r, 2, "full", HULL)
        set(r, 3, "full", HULL_DARK)
        fill(r, 4, 5, HULL)
        set(r, 6, "full", HULL_DARK)
        set(r, 7, "full", HULL)
    }

    // Engine narrows
    set(11, 2, "triNE", HULL)
    set(11, 3, "full", ENGINE)
    fill(11, 4, 5, HULL_DARK)
    set(11, 6, "full", ENGINE)
    set(11, 7, "triNW", HULL)

    // Engine
    fill(12, 3, 6, ENGINE)

    // Exhaust
    set(13, 3, "triNE", ENGINE)
    set(13, 4, "full", EXHAUST)
    set(13, 5, "full", EXHAUST)
    set(13, 6, "triNW", ENGINE)

    return grid
}

/** Grid coordinates the default loadout mounts hardware on. */
export const STARTER_MOUNTS = {
    turret: { col: 4, row: 0 },
    thrusters: [
        { col: 4, row: 12 },
        { col: 5, row: 12 }
    ]
} as const
