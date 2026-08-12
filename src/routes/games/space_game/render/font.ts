// Bitmap fonts cut out of the sheets in assets/fonts

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

import { browser } from "$app/environment"
import { Assert } from "../dev/assert"
import type { MeshBuilder } from "./mesh"
import type { Color } from "./color"

/*
 * Sheet format is name_type_WxH.png: a 16x6 grid of cells starting at code point
 * 32, so codes 32..127 row-major. Glyphs are white or transparent only, which is
 * why "lit" is an alpha test and nothing else.
 *
 * No texture, no atlas, no UVs - each run of lit pixels becomes geometry in the
 * same interleaved [x, y, r, g, b] stream as everything else, so text goes into
 * an ordinary Mesh through the ordinary pipeline.
 *
 * Coordinates are y-DOWN to match the camera: (x, y) is the top-left of the
 * first glyph's box.
 */

export type FontType = "mono" | "spaced"
export type TextAlign = "left" | "center" | "right" | "justify"

/** One horizontal run of lit pixels: [row, column, length]. */
type Run = readonly [number, number, number]

export interface Glyph {
    /** Columns the glyph occupies. Its advance is this plus letterSpacing. */
    readonly width: number
    /**
     * Lit pixels merged into horizontal runs, in glyph-local pixels, with the left
     * trim and any descender shift already applied.
     *
     * A row of "#####" becomes one quad instead of five, which cuts the geometry
     * for typical text by more than half.
     */
    readonly runs: readonly Run[]
}

const EMPTY_GLYPH: Glyph = { width: 0, runs: [] }

/** The parts of a font the sheet cannot decide for itself. */
export interface FontOptions {
    letterSpacing: number
    lineSpacing: number
    spaceWidth: number
}

export interface TextOptions {
    /** Defaults to "left". */
    align?: TextAlign
    /**
     * Box width in world units to align within. Defaults to the widest line, which
     * makes center and right behave as block alignment relative to the text itself.
     * Justify wants a real width - given the default, the widest line is already
     * full and every other line just stretches to match it.
     */
    width?: number
    /**
     * Justify the final line too. Off by default because a short last line stretched
     * across the full measure is the classic ugly justification artifact.
     */
    justifyLastLine?: boolean
}

const SHEET_COLUMNS = 16
const SHEET_ROWS = 6
/** Code point of the top-left cell. The table starts at space. */
const FIRST_CODE = 32

const DESCENDERS = new Set("gjpqy")
const DESCENDER_DEPTH = 2

/** Alpha at or above this counts as lit. The sheets only ever use 0 or 255. */
const ALPHA_THRESHOLD = 128

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
     * Callers sizing a box around text want this on top of measureTextHeight,
     * which counts whole cells only.
     */
    descent = 0

    /**
     * Resolves once the sheet has been read, whether or not it worked - check
     * `loaded` for that. Never rejects, so a bad sheet cannot take a scene down.
     */
    readonly ready: Promise<BitmapFont>

    private readonly glyphs = new Map<string, Glyph>()

    /**
     * Drawn for a character the sheet has no cell for.
     *
     * Empty until the sheet loads, so text is simply absent during the fetch
     * rather than flashing a wall of boxes for a frame or two.
     */
    private missing: Glyph = EMPTY_GLYPH

    constructor(
        name: string,
        type: FontType,
        url: string,
        glyphWidth: number,
        glyphHeight: number,
        options: Partial<FontOptions> = {},
    ) {
        this.name = name
        this.type = type
        this.url = url
        this.glyphWidth = glyphWidth
        this.glyphHeight = glyphHeight

        this.letterSpacing = options.letterSpacing ?? 1
        this.lineSpacing = options.lineSpacing ?? 3

        // Monospace keeps every cell the same width, the blank ones included
        this.spaceWidth =
            options.spaceWidth ?? (type === "mono" ? glyphWidth : Math.ceil(glyphWidth / 2))

        this.ready = this.load()
    }

    get lineAdvance(): number {
        return this.glyphHeight + this.lineSpacing
    }

    glyph(character: string): Glyph {
        return this.glyphs.get(character) ?? this.missing
    }

    has(character: string): boolean {
        return this.glyphs.has(character)
    }

    /** Advance for one character, in world units. */
    private advance(character: string, pixelSize: number): number {
        return (this.glyph(character).width + this.letterSpacing) * pixelSize
    }

    /**
     * Appends `text` as quads into `builder`.
     *
     * @param x,y top-left of the first glyph's box, y-down
     * @param pixelSize world units per font pixelSize - a cell is glyphWidth x glyphHeight of these
     * @returns width of the widest line, in world units
     */
    appendText(
        builder: MeshBuilder,
        text: string,
        x: number,
        y: number,
        pixelSize: number,
        color: Color,
        options: TextOptions = {},
    ): number {
        const align = options.align ?? "left"
        const lines = text.split("\n")
        const widths = lines.map((line) => this.measureLine(line, pixelSize))
        const blockWidth = options.width ?? Math.max(0, ...widths)

        let cursorY = y

        for (let index = 0; index < lines.length; index++) {
            const line = lines[index]!
            const slack = blockWidth - widths[index]!

            let startX = x
            let perGap = 0
            let wideGaps = 0

            if (align === "center") {
                startX = x + slack / 2
            } else if (align === "right") {
                startX = x + slack
            } else if (align === "justify" && (options.justifyLastLine || index < lines.length - 1)) {
                // Whole font pixels only, so justified text stays on the pixelSize grid -
                // fractional offsets smear it against a pixelated canvas
                const distributed = distributeSlack(Math.floor(slack / pixelSize), countSpaces(line))
                perGap = distributed.perGap
                wideGaps = distributed.wideGaps
            }

            this.appendLine(builder, line, startX, cursorY, pixelSize, color, perGap, wideGaps)
            cursorY += this.lineAdvance * pixelSize
        }

        return blockWidth
    }

    private appendLine(
        builder: MeshBuilder,
        line: string,
        x: number,
        y: number,
        pixelSize: number,
        color: Color,
        perGap: number,
        wideGaps: number,
    ): void {
        let cursorX = x
        let gap = 0

        // for...of over a string walks code points, not UTF-16 units
        for (const character of line) {
            for (const [row, column, length] of this.glyph(character).runs) {
                builder.quad(cursorX + column * pixelSize, y + row * pixelSize, length * pixelSize, pixelSize, color)
            }

            cursorX += this.advance(character, pixelSize)

            if (character === " ") {
                cursorX += (perGap + (gap < wideGaps ? 1 : 0)) * pixelSize
                gap++
            }
        }
    }

    /** Width of the widest line, in world units. */
    measureText(text: string, pixelSize: number): number {
        let widest = 0
        for (const line of text.split("\n")) widest = Math.max(widest, this.measureLine(line, pixelSize))
        return widest
    }

    /** Width of a single line. No newline handling. */
    private measureLine(line: string, pixelSize: number): number {
        let width = 0
        for (const character of line) width += this.advance(character, pixelSize)

        // The trailing letterSpacing after the last glyph is not part of the text
        return Math.max(0, width - this.letterSpacing * pixelSize)
    }

    /** Height in world units, counting whole cells only - see `descent`. */
    measureTextHeight(text: string, pixelSize: number): number {
        let lines = 1
        for (const character of text) if (character === "\n") lines++
        return (lines * this.lineAdvance - this.lineSpacing) * pixelSize
    }

    /** Word-wraps to `maxWidth` world units, hard-breaking words that cannot fit. */
    wrap(text: string, maxWidth: number, pixelSize: number): string {
        return wrapText(text, maxWidth, (line) => this.measureText(line, pixelSize))
    }

    /**
     * Fetches the sheet and cuts it into glyphs.
     *
     * Failures are logged rather than thrown: this runs detached from whatever
     * created the font, so a rejection would surface as an unhandled promise with
     * no obvious owner. `loaded` stays false and the font draws nothing.
     */
    private async load(): Promise<BitmapFont> {
        // FONTS is built at module scope, so importing this file on the server would
        // otherwise fetch a relative URL and log a failure on every single render
        if (!browser) return this

        try {
            const image = await loadImageData(this.url)

            const columns = Math.floor(image.width / this.glyphWidth)
            const rows = Math.floor(image.height / this.glyphHeight)

            Assert.that(
                columns === SHEET_COLUMNS,
                `Font "${this.name}" is ${columns} cells wide, expected ${SHEET_COLUMNS} - ` +
                    `check the WxH in its filename against the ${image.width}x${image.height} sheet`,
            )

            // Trailing rows past the table are ignored rather than mapped onto code
            // points the format says nothing about
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

        // A blank cell: space, and anything the sheet leaves empty
        if (!bounds) return { width: this.spaceWidth, runs: [] }

        // Monospace is centered in its cell, so trimming would destroy the very
        // alignment that makes it monospace. Spaced sheets are left-aligned, where
        // trimming to the measured ink box is exactly the intent.
        const trimX = this.type === "mono" ? 0 : bounds.left
        const width = this.type === "mono" ? this.glyphWidth : bounds.right - bounds.left + 1

        // Only a sheet that raised its descenders to fit them inside the cell needs
        // this, and that is exactly a sheet whose art starts above the row a
        // descender would otherwise begin on. Detected rather than configured.
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
        originX: number,
        originY: number,
        trimX: number,
        shiftY: number,
    ): Run[] {
        const runs: Run[] = []

        for (let y = 0; y < this.glyphHeight; y++) {
            let start = -1

            // One column past the edge, so a run touching the right edge of the cell
            // still gets closed off
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

/**
 * Word-wraps `text` so no line measures wider than `maxWidth`.
 *
 * `measure` is injected rather than read off a font so the algorithm stays pure -
 * no sheet, no GPU, no await - which is what makes it testable.
 *
 * Words wider than a whole line are hard-broken by code point; everything else
 * breaks on spaces.
 */
export function wrapText(
    text: string,
    maxWidth: number,
    measure: (line: string) => number,
): string {
    // A zero, negative or NaN width fits nothing and would loop forever below
    if (!(maxWidth > 0)) return text

    const lines: string[] = []

    for (const paragraph of text.split("\n")) {
        // A deliberate blank line. Without this case it falls through the word loop
        // and silently disappears.
        if (paragraph.length === 0) {
            lines.push("")
            continue
        }

        let line = ""

        for (const word of paragraph.split(" ")) {
            const candidate = line === "" ? word : `${line} ${word}`

            if (measure(candidate) <= maxWidth) {
                line = candidate
                continue
            }

            if (line !== "") {
                lines.push(line)
                line = ""
            }

            if (measure(word) <= maxWidth) {
                line = word
                continue
            }

            // The word alone still does not fit, so break it by code point. The
            // `chunk !== ""` guard is what stops a single character wider than the
            // whole line from looping forever - it gets a line to itself instead.
            let chunk = ""
            for (const character of word) {
                if (chunk !== "" && measure(chunk + character) > maxWidth) {
                    lines.push(chunk)
                    chunk = ""
                }
                chunk += character
            }
            line = chunk
        }

        lines.push(line)
    }

    return lines.join("\n")
}

/**
 * Splits `slackPixels` across `gaps` word gaps, in whole pixels.
 *
 * `wideGaps` leading gaps take one extra pixelSize each, so the remainder is spread
 * along the line rather than dumped entirely on the last gap.
 */
export function distributeSlack(slackPixels: number, gaps: number): { perGap: number; wideGaps: number } {
    if (gaps <= 0 || slackPixels <= 0) return { perGap: 0, wideGaps: 0 }

    const perGap = Math.floor(slackPixels / gaps)
    return { perGap, wideGaps: slackPixels - perGap * gaps }
}

function countSpaces(line: string): number {
    let count = 0
    for (const character of line) if (character === " ") count++
    return count
}

async function loadImageData(url: string): Promise<ImageData> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)

    const bitmap = await createImageBitmap(await response.blob(), {
        premultiplyAlpha: "none", // don't scale RGB by alpha
        colorSpaceConversion: "none", // ignore any embedded ICC profile
    })

    // Read these before close() - a closed bitmap reports 0x0
    const { width, height } = bitmap

    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext("2d")
    Assert.exists(context, "2d context for font sheet")

    context.drawImage(bitmap, 0, 0)
    bitmap.close() // frees the decoded copy; without it you hold two

    return context.getImageData(0, 0, width, height)
}

function isLit(image: ImageData, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false
    return image.data[(y * image.width + x) * 4 + 3]! >= ALPHA_THRESHOLD
}

/** Tightest lit box within a cell, or null when the cell is blank. */
function litBounds(image: ImageData, originX: number, originY: number, width: number, height: number) {
    let left = width
    let right = -1
    let top = height
    let bottom = -1

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

const fontUrls = import.meta.glob("../assets/fonts/*_*_*x*.png", {
    query: "?url",
    import: "default",
    eager: true,
}) as Record<string, string>

/**
 * Spacing a sheet cannot state for itself.
 *
 * Everything else is measured off the pixels, so a font only needs an entry here
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

    if (!Number.isFinite(width) || !Number.isFinite(height) || width! < 1 || height! < 1) {
        console.error(`font: "${file}" has no usable WxH, skipping`)
        return null
    }

    return new BitmapFont(name, type, url, width!, height!, OVERRIDES[name])
}

export const FONTS: readonly BitmapFont[] = Object.entries(fontUrls)
    .map(([path, url]) => fromPath(path, url))
    .filter((font): font is BitmapFont => font !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

Assert.that(
    FONTS.length > 0,
    "No font sheets found - assets/fonts needs at least one PNG named name_type_WxH.png",
)

export const FONT_NAMES: readonly string[] = FONTS.map((font) => font.name)

export const DEFAULT_FONT: BitmapFont = FONTS.find((font) => font.type === "mono") ?? FONTS[0]!

export function fontByName(name: string): BitmapFont {
    return FONTS.find((font) => font.name === name) ?? DEFAULT_FONT
}

/** Awaitable gate for a startup that wants every sheet read before drawing. */
export function fontsReady(): Promise<void> {
    return Promise.all(FONTS.map((font) => font.ready)).then(() => undefined)
}

