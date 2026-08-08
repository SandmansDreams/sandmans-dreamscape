/* FONT FORMAT:
- Width is divisible by glyph width, height is divisible by glyph height
- All glyphs fit within assigned dimensions, should be 16 X 6
- All glyphs are left-aligned (or center aligned for monospace)
- All glyphs are vertically aligned as intended
- All glyphs composed of white or transparent pixels only
- Naming Convention: "name_type_WxH" for auto assigning (type is mono or spaced)
- Standard offsets (non-mono):
    y offset:
        -2: g j p q y
    x width:
        -2: " ( ) * + - < = > [ ] ^ ` j l { | }
        -4: ! ' , . : ;

- File formatting (seems to be standard):
      ! " # $ % & ' ( ) * + , - . /
    0 1 2 3 4 5 6 7 8 9 : ; < = > ?
    @ A B C D E F G H I J K L M N O
    P Q R S T U V W X Y Z [ \ ] ^ _
    ` a b c d e f g h i j k l m n o
    p q r s t u v w x y z { | } ~
*/

/**
 * Bitmap fonts cut out of the sheets in assets/fonts.
 *
 * No texture, no atlas, no UVs - each lit pixel becomes geometry in the same
 * interleaved [x, y, r, g, b] stream as everything else, so text goes into an
 * ordinary Mesh and through the post-processing chain with the rest of a scene.
 *
 * Coordinates are y-DOWN to match shapes.ts: (x, y) is the top-left of the
 * first glyph's box.
 *
 * The x-width table in the notes above is treated as documentation rather than
 * data - the widths are measured off the sheet instead. The sheets disagree
 * with the table in a few places (Stylized draws `|` one column wide and ` two,
 * not three, and the table has nothing to say about `1` or `i`), and measuring
 * is both correct for those and free for any sheet added later.
 */

import { Assert } from "../assert"

/*~~~ Sheet layout ~~~*/

/** Cells across a sheet, from the file formatting table above. */
const SHEET_COLUMNS = 16
/** Cells down a sheet. */
const SHEET_ROWS = 6
/** Code point of the top-left cell. The table starts at space. */
const FIRST_CODE = 32

/**
 * Characters the notes' "y offset: -2" row applies to, and how far down they
 * move. These are the descenders: art drawn up at cap height in the sheet that
 * belongs on the descender line.
 *
 * Whether a sheet actually needs the shift is decided per glyph rather than per
 * font, because only a sheet that raised its descenders to fit them in the cell
 * needs it - see cutGlyph. Stylized did raise them; Galactic and Mono draw
 * their equivalents on the line already and are left alone.
 */
const DESCENDERS = new Set("gjpqy")
const DESCENDER_DEPTH = 2

/** Alpha at or above this counts as lit. The sheets only ever use 0 or 255. */
const ALPHA_THRESHOLD = 128

/*~~~ Glyphs ~~~*/

export type FontType = "mono" | "spaced"

/** One horizontal run of lit pixels: [row, column, length]. */
type Run = readonly [number, number, number]

export interface Glyph {
    /** Columns the glyph occupies. Its advance is this plus letterSpacing. */
    readonly width: number
    /**
     * Lit pixels merged into horizontal runs, in glyph-local pixels, with the
     * left trim and any descender shift already applied.
     *
     * A row of "#####" becomes one quad instead of five, which cuts the
     * geometry for typical text by more than half.
     */
    readonly runs: readonly Run[]
}

const EMPTY_GLYPH: Glyph = { width: 0, runs: [] }

/** The parts of a font that the sheet cannot decide for itself. */
export interface FontOptions {
    /** Blank columns between glyphs. */
    letterSpacing: number
    /** Blank rows between lines. */
    lineSpacing: number
    /** Advance for a blank cell, space included. */
    spaceWidth: number
}

export class BitmapFont {
    readonly name: string
    readonly type: FontType
    readonly url: string

    /** Cell size in font pixels, taken from the filename. */
    readonly glyphWidth: number
    readonly glyphHeight: number

    letterSpacing: number
    lineSpacing: number
    spaceWidth: number

    /** False until the sheet has been fetched and cut up. */
    loaded = false

    /**
     * How far below the cell the lowest descender reaches, in font pixels.
     *
     * 0 for a sheet that needed no shifting. Callers that size a box around
     * text want this on top of measureTextHeight, which only counts cells.
     */
    descent = 0

    /**
     * Resolves once the sheet has been read, whether or not it worked - check
     * `loaded` for that. It never rejects, so a bad sheet cannot take a scene
     * down with it; the failure is logged instead.
     */
    readonly ready: Promise<BitmapFont>

    private readonly glyphs = new Map<string, Glyph>()

    /**
     * Drawn for a character the sheet has no cell for.
     *
     * Empty until the sheet loads, so text simply does not appear during the
     * fetch rather than flashing a wall of boxes for a frame or two.
     */
    private missing: Glyph = EMPTY_GLYPH

    constructor(
        name: string,
        type: FontType,
        url: string,
        glyphWidth: number,
        glyphHeight: number,
        options: Partial<FontOptions> = {}
    ) {
        this.name = name
        this.type = type
        this.url = url
        this.glyphWidth = glyphWidth
        this.glyphHeight = glyphHeight

        this.letterSpacing = options.letterSpacing ?? 1
        this.lineSpacing = options.lineSpacing ?? 3
        // Monospace keeps every cell the same width, the blank ones included.
        this.spaceWidth =
            options.spaceWidth ?? (type === "mono" ? glyphWidth : Math.ceil(glyphWidth / 2))

        this.ready = this.load()
    }

    /** Distance from one line's top to the next, in font pixels. */
    get lineAdvance(): number {
        return this.glyphHeight + this.lineSpacing
    }

    /** The glyph for `character`, or the missing-glyph box. */
    glyph(character: string): Glyph {
        return this.glyphs.get(character) ?? this.missing
    }

    /** True if the sheet has a cell for this character. */
    has(character: string): boolean {
        return this.glyphs.has(character)
    }

    /**
     * Appends `text` as interleaved [x, y, r, g, b] triangles into `out`.
     *
     * @param x,y top-left of the first glyph's box, y-down
     * @param pixel world units per font pixel - a cell is glyphWidth x glyphHeight of these
     * @returns width of the widest line, in world units
     */
    appendText(
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
                widest = Math.max(widest, cursorX - x - this.letterSpacing * pixel)
                cursorX = x
                cursorY += this.lineAdvance * pixel
                continue
            }

            const glyph = this.glyph(character)

            for (const [row, column, length] of glyph.runs) {
                const left = cursorX + column * pixel
                const top = cursorY + row * pixel
                pushQuad(out, left, top, left + length * pixel, top + pixel, r, g, b)
            }

            cursorX += (glyph.width + this.letterSpacing) * pixel
        }

        // The trailing spacing after the last glyph is not part of the text
        return Math.max(0, widest, cursorX - x - this.letterSpacing * pixel)
    }

    /** Width of `text` in world units, without building any geometry. */
    measureText(text: string, pixel: number): number {
        let widest = 0
        let line = 0

        for (const character of text) {
            if (character === "\n") {
                widest = Math.max(widest, line - this.letterSpacing * pixel)
                line = 0
                continue
            }
            line += (this.glyph(character).width + this.letterSpacing) * pixel
        }

        return Math.max(0, widest, line - this.letterSpacing * pixel)
    }

    /** Height of `text` in world units, counting whole cells only - see `descent`. */
    measureTextHeight(text: string, pixel: number): number {
        let lines = 1
        for (const character of text) if (character === "\n") lines++
        return (lines * this.lineAdvance - this.lineSpacing) * pixel
    }

    /**
     * Fetches the sheet and cuts it into glyphs.
     *
     * Failures are logged rather than thrown: this runs detached from whatever
     * created the font, so a rejection here would surface as an unhandled
     * promise with no obvious owner. `loaded` stays false and the font draws
     * nothing, which is visible enough alongside the logged error.
     */
    private async load(): Promise<BitmapFont> {
        try {
            const image = await loadImageData(this.url)

            const columns = Math.floor(image.width / this.glyphWidth)
            const rows = Math.floor(image.height / this.glyphHeight)

            Assert.that(
                columns === SHEET_COLUMNS,
                `Font "${this.name}" is ${columns} cells wide, expected ${SHEET_COLUMNS} - ` +
                `check the WxH in its filename against the ${image.width}x${image.height} sheet`
            )

            // Trailing rows past the table are ignored rather than mapped onto
            // code points the format says nothing about.
            for (let row = 0; row < Math.min(rows, SHEET_ROWS); row++) {
                for (let column = 0; column < columns; column++) {
                    const character = String.fromCharCode(FIRST_CODE + row * columns + column)
                    this.glyphs.set(character, this.cutGlyph(image, character, column, row))
                }
            }

            this.missing = this.buildMissing()
            this.loaded = true
        } catch (error) {
            console.error(`font: could not load "${this.name}" from ${this.url}`, error)
        }

        return this
    }

    /** One cell, trimmed and offset according to the font's type. */
    private cutGlyph(image: ImageData, character: string, column: number, row: number): Glyph {
        const originX = column * this.glyphWidth
        const originY = row * this.glyphHeight
        const bounds = litBounds(image, originX, originY, this.glyphWidth, this.glyphHeight)

        // A blank cell: space, and anything the sheet leaves empty.
        if (!bounds) return { width: this.spaceWidth, runs: [] }

        // Monospace is centred in its cell, so trimming would destroy the very
        // alignment that makes it monospace. Spaced sheets are left-aligned,
        // where trimming to the lit box is exactly the x-width table's intent.
        const trimX = this.type === "mono" ? 0 : bounds.left
        const width = this.type === "mono" ? this.glyphWidth : bounds.right - bounds.left + 1

        // The notes' "y offset: -2". A sheet only needs it if it raised its
        // descenders to fit them in the cell, and that is exactly a sheet where
        // the art starts above the row a descender would otherwise begin on.
        const shiftY =
            this.type !== "mono" && DESCENDERS.has(character) && bounds.top < DESCENDER_DEPTH
                ? DESCENDER_DEPTH
                : 0

        if (shiftY > 0) this.descent = Math.max(this.descent, shiftY)

        return { width, runs: this.cutRuns(image, originX, originY, trimX, shiftY) }
    }

    /** A cell's lit pixels as merged horizontal runs. */
    private cutRuns(
        image: ImageData,
        originX: number, originY: number,
        trimX: number, shiftY: number
    ): Run[] {
        const runs: Run[] = []

        for (let y = 0; y < this.glyphHeight; y++) {
            let start = -1

            // One column past the edge, so a run touching the right edge of the
            // cell still gets closed off.
            for (let x = 0; x <= this.glyphWidth; x++) {
                const lit = x < this.glyphWidth && isLit(image, originX + x, originY + y)

                if (lit && start < 0) start = x
                else if (!lit && start >= 0) {
                    runs.push([y + shiftY, start - trimX, x - start])
                    start = -1
                }
            }
        }

        return runs
    }

    /** A hollow box the size of a cell, so a missing character is obvious. */
    private buildMissing(): Glyph {
        const width = this.glyphWidth
        const last = this.glyphHeight - 1
        const runs: Run[] = [[0, 0, width], [last, 0, width]]

        for (let y = 1; y < last; y++) runs.push([y, 0, 1], [y, width - 1, 1])

        return { width, runs }
    }
}

/*~~~ Reading a sheet ~~~*/

async function loadImageData(url: string): Promise<ImageData> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)

    const bitmap = await createImageBitmap(await res.blob(), {
        premultiplyAlpha: "none",      // don't scale RGB by alpha
        colorSpaceConversion: "none",  // ignore any embedded ICC profile
    })

    // Grab these before close() — a closed bitmap reports 0x0
    const { width, height } = bitmap

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()  // frees the decoded copy; without it you hold 2x the memory

    return ctx.getImageData(0, 0, width, height)
}

function isLit(image: ImageData, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false
    return image.data[(y * image.width + x) * 4 + 3] >= ALPHA_THRESHOLD
}

interface Bounds {
    left: number
    right: number
    top: number
    bottom: number
}

/** The tightest box around one cell's lit pixels, or null if the cell is blank. */
function litBounds(
    image: ImageData,
    originX: number, originY: number,
    width: number, height: number
): Bounds | null {
    let left = width, right = -1, top = height, bottom = -1

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!isLit(image, originX + x, originY + y)) continue

            if (x < left) left = x
            if (x > right) right = x
            if (y < top) top = y
            if (y > bottom) bottom = y
        }
    }

    return right < 0 ? null : { left, right, top, bottom }
}

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

/*~~~ The sheets in assets/fonts ~~~*/

const fontUrls = import.meta.glob("../assets/fonts/*_*_*x*.png", {
    query: "?url",
    import: "default",
    eager: true,
}) as Record<string, string>

/**
 * Per-font tweaks, keyed by the name in the filename.
 *
 * Everything else is read off the sheet, so a font only needs an entry here
 * when the measured spacing does not suit it.
 */
const OVERRIDES: Record<string, Partial<FontOptions>> = {}

/** "../assets/fonts/SpaceGameMono_mono_5x7.png" -> a font, or null if the name does not parse. */
function fromPath(path: string, url: string): BitmapFont | null {
    const file = path.split("/").pop()?.replace(/\.png$/, "") ?? ""
    const [name, type, size] = file.split("_")

    if (!name || (type !== "mono" && type !== "spaced")) {
        console.error(`font: "${file}" does not match name_type_WxH, skipping`)
        return null
    }

    const [width, height] = (size ?? "").split("x").map(Number)

    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        console.error(`font: "${file}" has no usable WxH, skipping`)
        return null
    }

    return new BitmapFont(name, type, url, width, height, OVERRIDES[name])
}

/** Every sheet in assets/fonts, in name order. */
export const FONTS: readonly BitmapFont[] = Object.entries(fontUrls)
    .map(([path, url]) => fromPath(path, url))
    .filter((font): font is BitmapFont => font !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

Assert.that(
    FONTS.length > 0,
    "No font sheets found - assets/fonts needs at least one PNG named name_type_WxH.png"
)

/** Names in FONTS order, ready to hand to a selection setting. */
export const FONT_NAMES: readonly string[] = FONTS.map((font) => font.name)

export const DEFAULT_FONT: BitmapFont =
    FONTS.find((font) => font.type === "mono") ?? FONTS[0]

/** The named font, falling back to the default rather than returning undefined. */
export function fontByName(name: string): BitmapFont {
    return FONTS.find((font) => font.name === name) ?? DEFAULT_FONT
}

/** Resolves once every sheet has been read. See BitmapFont.ready - it never rejects. */
export function fontsReady(): Promise<void> {
    return Promise.all(FONTS.map((font) => font.ready)).then(() => undefined)
}
