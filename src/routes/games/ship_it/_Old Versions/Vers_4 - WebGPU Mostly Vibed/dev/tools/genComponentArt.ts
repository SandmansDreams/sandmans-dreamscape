/*
 * Draws a starting piece of art for every component that has none.
 *
 * Run with `npm run art`. Output goes through `artToText`, the same writer the
 * sprite editor's download uses, so a generated file and a hand-drawn one are the
 * same kind of thing - open one in the editor, change a square, save it back, and
 * only that square differs.
 *
 * These are starting points, not finished art. The point is that every component
 * reads as itself at a glance instead of as the placeholder hexagon, and that
 * there is something to edit rather than an empty canvas.
 */

import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { artToText, emptyArt, type ComponentArt } from "../../game/componentArt"
import { Color } from "../../render/color"
import type { ArtGrid } from "../../render/grid/artGrid"
import type { BlockShape } from "../../render/grid/shapes"
import type { ArtLayer, ArtRole } from "../../render/grid/spriteMesh"

/*~~~ The palette these pieces are drawn in ~~~*/

/**
 * Static squares need a colour of their own, because nothing recolours them.
 *
 * Three shades and no more: art that shares a palette reads as one fleet, and a
 * piece that invented its own greys would look like it came from another game.
 */
const FRAME = Color.from("#2b3340")
const METAL = Color.from("#545454")
const SHADOW = Color.from("#1b2029")

/*~~~ Drawing helpers ~~~*/

/**
 * One rectangle of squares. Inclusive on both corners, as `ArtGrid.fill` is.
 *
 * `role` decides how the rectangle takes colour at runtime, which is the whole
 * reason to reach for one shade over another:
 *  - `main` is replaced by the cell's own colour, so the player's paint shows
 *  - `accent` is replaced by the cell's accent, so the working part stands out
 *  - `static` keeps what is passed here, and is how a piece gets its framing
 */
interface Rect {
    c: number
    r: number
    c2?: number
    r2?: number
    role?: ArtRole
    layer?: ArtLayer
    shape?: BlockShape
    turns?: number
    mirrored?: boolean
    color?: Color
}

/** A piece: its registry id, its display name, and the rectangles it is made of. */
interface Piece {
    id: string
    name: string
    rects: readonly Rect[]
}

function draw(art: ComponentArt, rects: readonly Rect[]): void {
    for (const rect of rects) {
        const grid: ArtGrid = art.layers[rect.layer ?? "base"]

        grid.fill(rect.c, rect.r, rect.c2 ?? rect.c, rect.r2 ?? rect.r, rect.shape ?? "full", {
            role: rect.role ?? "static",
            color: rect.color ?? METAL,
            turns: rect.turns,
            mirrored: rect.mirrored,
        })
    }
}

/**
 * The frame every boxy component wears, one square thick.
 *
 * Shared rather than repeated because the hull plate, the crate and the battery
 * all want the same outline, and three copies of it would drift apart the first
 * time one was adjusted.
 */
function boxFrame(color = FRAME): Rect[] {
    return [
        { c: 0, r: 0, c2: 15, color },
        { c: 0, r: 15, c2: 15, color },
        { c: 0, r: 1, r2: 14, color },
        { c: 15, r: 1, r2: 14, color },
    ]
}

/*~~~ The pieces ~~~*/

/*
 * Everything here is authored pointing NORTH, at the top of the canvas.
 *
 * `appendArt` rotates the baked triangles by the cell's `facing` on the CPU, so
 * one piece serves all four headings. North is the business end: a thruster's
 * nozzle, a weapon's muzzle, a dish's opening. For a thruster that is exactly
 * right and worth saying out loud - exhaust leaves the way the thruster points,
 * so a nozzle drawn at the top pushes the ship the other way.
 */
const PIECES: readonly Piece[] = [
    {
        id: "hull-plate",
        name: "Hull Plate",
        // The most-placed block in the game, so it is deliberately quiet: a frame,
        // a field of the player's colour, and four rivets to break up a wall of
        // them. Anything busier tiles into noise.
        rects: [
            { c: 0, r: 0, c2: 15, r2: 15, role: "main" },
            ...boxFrame(),
            { c: 2, r: 2, c2: 3, r2: 3, color: SHADOW },
            { c: 12, r: 2, c2: 13, r2: 3, color: SHADOW },
            { c: 2, r: 12, c2: 3, r2: 13, color: SHADOW },
            { c: 12, r: 12, c2: 13, r2: 13, color: SHADOW },
        ],
    },

    {
        id: "ion-thruster",
        name: "Ion Thruster",
        // A bell: widest at the mouth and narrowing into the body. The flare is
        // what makes it an engine rather than a pipe - a constant-width column
        // reads as neither, which is what the first pass drew.
        rects: [
            { c: 5, r: 0, c2: 10, r2: 1, role: "accent" },
            { c: 6, r: 2, c2: 9, r2: 2, role: "accent" },
            { c: 4, r: 0, r2: 2, color: METAL },
            { c: 11, r: 0, r2: 2, color: METAL },
            { c: 5, r: 2, color: METAL },
            { c: 10, r: 2, color: METAL },

            { c: 6, r: 3, c2: 9, r2: 11, role: "main" },
            { c: 5, r: 3, r2: 11, color: METAL },
            { c: 10, r: 3, r2: 11, color: METAL },

            { c: 4, r: 12, c2: 11, r2: 15, color: FRAME },
            { c: 7, r: 12, c2: 8, r2: 14, role: "accent" },
        ],
    },

    {
        id: "chem-thruster",
        name: "Chem Thruster",
        // Twin nozzles and a wider body: heavier at a glance, which is what its
        // mass and thrust say on paper
        rects: [
            { c: 3, r: 0, c2: 6, r2: 2, role: "accent" },
            { c: 9, r: 0, c2: 12, r2: 2, role: "accent" },
            { c: 2, r: 3, c2: 13, r2: 4, color: FRAME },
            { c: 3, r: 5, c2: 12, r2: 13, role: "main" },
            { c: 7, r: 5, c2: 8, r2: 9, role: "accent" },
            { c: 2, r: 5, r2: 13, color: METAL },
            { c: 13, r: 5, r2: 13, color: METAL },
            { c: 1, r: 14, c2: 14, r2: 15, color: FRAME },
        ],
    },

    {
        id: "crate",
        name: "Crate",
        // Deliberately dull. It is cargo, and it should lose the eye to anything
        // that actually does something.
        rects: [
            { c: 1, r: 1, c2: 14, r2: 14, role: "main" },
            ...boxFrame(),
            { c: 1, r: 4, c2: 14, r2: 5, color: METAL },
            { c: 1, r: 10, c2: 14, r2: 11, color: METAL },
            { c: 7, r: 1, c2: 8, r2: 14, color: METAL },
        ],
    },

    {
        id: "battery",
        name: "Battery",
        // The charge bar is the whole read: a crate with a lit strip down one side
        // is a battery, and nothing else in the game looks like that
        rects: [
            { c: 1, r: 1, c2: 14, r2: 14, role: "main" },
            ...boxFrame(),
            { c: 2, r: 2, c2: 4, r2: 13, role: "accent" },
            { c: 6, r: 3, c2: 13, r2: 4, color: METAL },
            { c: 6, r: 7, c2: 13, r2: 8, color: METAL },
            { c: 6, r: 11, c2: 13, r2: 12, color: METAL },
        ],
    },

    {
        id: "fusion-core",
        name: "Fusion Core",
        // The one piece that should read as hot. An octagonal housing built from
        // stacked rows, a lit core, and four vents so it reads as radial rather
        // than as another box.
        rects: [
            { c: 4, r: 1, c2: 11, r2: 1, role: "main" },
            { c: 3, r: 2, c2: 12, r2: 2, role: "main" },
            { c: 2, r: 3, c2: 13, r2: 3, role: "main" },
            { c: 1, r: 4, c2: 14, r2: 11, role: "main" },
            { c: 2, r: 12, c2: 13, r2: 12, role: "main" },
            { c: 3, r: 13, c2: 12, r2: 13, role: "main" },
            { c: 4, r: 14, c2: 11, r2: 14, role: "main" },

            { c: 5, r: 5, c2: 10, r2: 10, role: "accent" },
            { c: 6, r: 4, c2: 9, r2: 4, color: SHADOW },
            { c: 6, r: 11, c2: 9, r2: 11, color: SHADOW },
            { c: 4, r: 6, c2: 4, r2: 9, color: SHADOW },
            { c: 11, r: 6, c2: 11, r2: 9, color: SHADOW },
        ],
    },

    {
        id: "shield-projector",
        name: "Shield Projector",
        // A deep bowl cupped north, built as stacked rows so the walls climb: the
        // curve is the read, and a flat bar with a rod on it - the first pass -
        // read as a hammer instead.
        rects: [
            { c: 1, r: 4, c2: 2, r2: 9, role: "main" },
            { c: 3, r: 6, c2: 4, r2: 9, role: "main" },
            { c: 5, r: 7, c2: 10, r2: 9, role: "main" },
            { c: 11, r: 6, c2: 12, r2: 9, role: "main" },
            { c: 13, r: 4, c2: 14, r2: 9, role: "main" },

            { c: 1, r: 3, c2: 2, r2: 3, color: METAL },
            { c: 13, r: 3, c2: 14, r2: 3, color: METAL },
            { c: 3, r: 10, c2: 12, r2: 11, color: METAL },

            { c: 7, r: 11, c2: 8, r2: 13, color: METAL },
            { c: 5, r: 13, c2: 10, r2: 15, color: FRAME },

            // At the focus of the bowl, which is what a projector projects from
            { c: 7, r: 4, c2: 8, r2: 7, role: "accent" },
            { c: 6, r: 2, c2: 9, r2: 3, role: "accent" },
        ],
    },

    {
        id: "radar-dish",
        name: "Radar Dish",
        // Wide and shallow where the projector is narrow and deep, and open
        // underneath where the projector is solid. They share a category, so the
        // silhouette is the only thing that can tell them apart at one cell wide.
        rects: [
            { c: 0, r: 5, c2: 1, r2: 7, role: "main" },
            { c: 2, r: 4, c2: 3, r2: 6, role: "main" },
            { c: 4, r: 3, c2: 11, r2: 5, role: "main" },
            { c: 12, r: 4, c2: 13, r2: 6, role: "main" },
            { c: 14, r: 5, c2: 15, r2: 7, role: "main" },

            // Ribs rather than a back: the gaps between them are the open half
            { c: 3, r: 7, r2: 9, color: METAL },
            { c: 12, r: 7, r2: 9, color: METAL },
            { c: 7, r: 6, c2: 8, r2: 10, color: METAL },

            { c: 7, r: 10, c2: 8, r2: 13, color: METAL },
            { c: 5, r: 13, c2: 10, r2: 15, color: FRAME },

            { c: 7, r: 0, c2: 8, r2: 3, role: "accent" },
            { c: 6, r: 0, c2: 9, r2: 1, role: "accent" },
        ],
    },

    {
        id: "railgun",
        name: "Railgun",
        // Two rails with a lit gap between them, and a breech wide enough that it
        // reads as the bigger gun beside the autocannon's single barrel
        rects: [
            { c: 4, r: 0, c2: 6, r2: 10, color: METAL },
            { c: 9, r: 0, c2: 11, r2: 10, color: METAL },
            { c: 7, r: 0, c2: 8, r2: 10, role: "accent" },
            { c: 3, r: 11, c2: 12, r2: 15, role: "main" },
            { c: 2, r: 11, r2: 15, color: FRAME },
            { c: 13, r: 11, r2: 15, color: FRAME },
            { c: 3, r: 11, c2: 12, r2: 11, color: FRAME },
            { c: 6, r: 12, c2: 9, r2: 13, role: "accent" },
        ],
    },
]

/*~~~ Writing ~~~*/

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, "..", "..", "assets", "components")

for (const piece of PIECES) {
    const art = emptyArt(piece.id, piece.name)
    draw(art, piece.rects)

    const path = join(outDir, `${piece.id}.json`)
    writeFileSync(path, artToText(art))

    const squares = art.layers.base.size + art.layers.top.size
    console.log(`wrote ${piece.id}.json  (${squares} squares)`)
}

console.log(`\n${PIECES.length} pieces written to assets/components/`)
