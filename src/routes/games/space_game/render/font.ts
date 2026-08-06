/**
 * A 5x7 pixel font built from quads.
 *
 * No texture, no atlas, no UVs - each lit pixel becomes geometry in the same
 * interleaved [x, y, r, g, b] stream as everything else, so text goes into an
 * ordinary Mesh and through the post-processing chain with the rest of the
 * scene. Uppercase only; lowercase input is folded up.
 *
 * Coordinates are y-DOWN to match shapes.ts: (x, y) is the top-left of the
 * first glyph's box.
 */

export const GLYPH_WIDTH = 5
export const GLYPH_HEIGHT = 7
export const GLYPH_SPACING = 1  // blank columns between glyphs
export const LINE_SPACING = 2   // blank rows between lines

/** Advance from one glyph's left edge to the next, in font pixels. */
export const GLYPH_ADVANCE = GLYPH_WIDTH + GLYPH_SPACING
/** Distance from one line's top to the next, in font pixels. */
export const LINE_ADVANCE = GLYPH_HEIGHT + LINE_SPACING

// '#' is a lit pixel, '.' is empty. Written as art so a wrong pixel is
// visible in the source rather than hidden in a bitmask.
const GLYPHS: Record<string, string[]> = {
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#...#", "#.#.#", "##.##", "#...#"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],

    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],

    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
    ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
    ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
    ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
    ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    "_": [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
    "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
    "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
    "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
    "\\": ["#....", "#....", ".#...", "..#..", "...#.", "....#", "....#"],
    "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
    ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
    "[": ["..###", "..#..", "..#..", "..#..", "..#..", "..#..", "..###"],
    "]": ["###..", "..#..", "..#..", "..#..", "..#..", "..#..", "###.."],
    "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
    ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
    "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
    "*": [".....", "..#..", "#.#.#", ".###.", "#.#.#", "..#..", "....."],
    "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
    "%": ["##..#", "##.#.", "..#..", ".#...", "#..##", "...##", "....."],
    "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
    "\"": [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
}

/** Drawn for any character with no glyph, so a gap is obvious rather than silent. */
const MISSING = ["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"]

/** One horizontal run of lit pixels: [row, startColumn, length]. */
type Run = readonly [number, number, number]

/**
 * Lit pixels merged into horizontal runs, once at module load.
 *
 * A row of "#####" becomes one quad instead of five, which cuts the geometry
 * for typical text by more than half.
 */
function toRuns(rows: readonly string[]): Run[] {
    const runs: Run[] = []

    for (let row = 0; row < rows.length; row++) {
        let start = -1

        for (let col = 0; col <= GLYPH_WIDTH; col++) {
            const lit = col < GLYPH_WIDTH && rows[row][col] === "#"

            if (lit && start < 0) start = col
            else if (!lit && start >= 0) {
                runs.push([row, start, col - start])
                start = -1
            }
        }
    }

    return runs
}

const RUNS = new Map<string, Run[]>()
for (const [character, rows] of Object.entries(GLYPHS)) RUNS.set(character, toRuns(rows))
const MISSING_RUNS = toRuns(MISSING)

function pushQuad(
    out: number[],
    left: number, top: number, right: number, bottom: number,
    r: number, g: number, b: number
) {
    out.push(
        left, top, r, g, b,
        right, top, r, g, b,
        right, bottom, r, g, b,

        left, top, r, g, b,
        right, bottom, r, g, b,
        left, bottom, r, g, b
    )
}

/** True if the font has a glyph for this character (after folding to uppercase). */
export function hasGlyph(character: string): boolean {
    return RUNS.has(character.toUpperCase())
}

/**
 * Appends `text` as interleaved [x, y, r, g, b] triangles into `out`.
 *
 * @param x,y top-left of the first glyph's box, y-down
 * @param pixel world units per font pixel - a glyph is 5x7 of these
 * @returns width of the widest line, in world units
 */
export function appendText(
    out: number[],
    text: string,
    x: number, y: number,
    pixel: number,
    r: number, g: number, b: number
): number {
    let cursorX = x
    let cursorY = y
    let widest = 0

    for (const character of text) {
        if (character === "\n") {
            widest = Math.max(widest, cursorX - x - GLYPH_SPACING * pixel)
            cursorX = x
            cursorY += LINE_ADVANCE * pixel
            continue
        }

        const runs = RUNS.get(character.toUpperCase()) ?? MISSING_RUNS

        for (const [row, start, length] of runs) {
            const left = cursorX + start * pixel
            const top = cursorY + row * pixel
            pushQuad(out, left, top, left + length * pixel, top + pixel, r, g, b)
        }

        cursorX += GLYPH_ADVANCE * pixel
    }

    // The trailing spacing after the last glyph is not part of the text
    return Math.max(widest, cursorX - x - GLYPH_SPACING * pixel)
}

/** Width of `text` in world units, without building any geometry. */
export function measureText(text: string, pixel: number): number {
    let widest = 0
    let line = 0

    for (const character of text) {
        if (character === "\n") {
            widest = Math.max(widest, line)
            line = 0
            continue
        }
        line += GLYPH_ADVANCE * pixel
    }

    return Math.max(widest, line - GLYPH_SPACING * pixel)
}

/** Height of `text` in world units. */
export function measureTextHeight(text: string, pixel: number): number {
    let lines = 1
    for (const character of text) if (character === "\n") lines++
    return (lines * LINE_ADVANCE - LINE_SPACING) * pixel
}
