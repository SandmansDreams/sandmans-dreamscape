/**
 * Turns a bitmap font sheet into the string-art glyph table font.ts uses.
 *
 * Generated rather than transcribed: a sheet is ~2000 individual on/off pixels,
 * and eyeballing them produces a handful of silent errors that only surface
 * when a word looks subtly wrong.
 *
 *   npx tsx src/routes/games/space_game/dev/tools/gen-font.ts <image.png> [options]
 *
 *   --columns N    cells per row (default 16, the usual ASCII sheet)
 *   --rows N       stop after N rows, for sheets with a half to ignore
 *   --first N      code point of the first cell (default 32, space)
 *   --cell WxH     cell size in pixels (default: image width / columns, square)
 *   --threshold N  luminance 0-255 above which a pixel counts as lit (default 128)
 *   --name NAME    exported constant name (default GALACTIC_GLYPHS)
 *   --out PATH     write a module instead of printing
 */

import { readFileSync, writeFileSync } from "node:fs"
import { inflateSync } from "node:zlib"

/*~~~ PNG decoding ~~~*/

interface Bitmap {
    width: number
    height: number
    /** RGBA, 4 bytes per pixel. */
    pixels: Uint8Array
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function decodePng(file: Buffer): Bitmap {
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (file[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG file")
    }

    let width = 0
    let height = 0
    let bitDepth = 0
    let colorType = 0
    let interlace = 0
    let palette: Uint8Array | null = null
    let transparency: Uint8Array | null = null
    const idat: Buffer[] = []

    let offset = 8
    while (offset < file.length) {
        const length = file.readUInt32BE(offset)
        const type = file.toString("ascii", offset + 4, offset + 8)
        const data = file.subarray(offset + 8, offset + 8 + length)
        offset += 12 + length // length + type + data + crc

        if (type === "IHDR") {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            bitDepth = data[8]
            colorType = data[9]
            interlace = data[12]
        } else if (type === "PLTE") {
            palette = new Uint8Array(data)
        } else if (type === "tRNS") {
            transparency = new Uint8Array(data)
        } else if (type === "IDAT") {
            idat.push(data)
        } else if (type === "IEND") {
            break
        }
    }

    if (bitDepth !== 8) throw new Error(`Only 8-bit PNGs are supported, got ${bitDepth}-bit`)
    if (interlace !== 0) throw new Error("Interlaced PNGs are not supported - re-export without Adam7")

    // Bytes per pixel in the raw stream, which is what the filters operate on
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
    if (channels === undefined) throw new Error(`Unsupported PNG colour type ${colorType}`)

    const raw = inflateSync(Buffer.concat(idat))
    const stride = width * channels
    const lines = new Uint8Array(height * stride)

    // Undo the per-scanline filters. Each line is prefixed with its filter type.
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]
        const source = y * (stride + 1) + 1
        const target = y * stride

        for (let x = 0; x < stride; x++) {
            const value = raw[source + x]
            const left = x >= channels ? lines[target + x - channels] : 0
            const up = y > 0 ? lines[target + x - stride] : 0
            const upLeft = x >= channels && y > 0 ? lines[target + x - stride - channels] : 0

            let restored: number
            switch (filter) {
                case 0: restored = value; break
                case 1: restored = value + left; break
                case 2: restored = value + up; break
                case 3: restored = value + ((left + up) >> 1); break
                case 4: restored = value + paeth(left, up, upLeft); break
                default: throw new Error(`Unknown PNG filter ${filter} on line ${y}`)
            }

            lines[target + x] = restored & 0xff
        }
    }

    // Expand whatever colour type this was into plain RGBA
    const pixels = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        const source = i * channels
        const target = i * 4
        let r = 0, g = 0, b = 0, a = 255

        switch (colorType) {
            case 0: r = g = b = lines[source]; break
            case 2: r = lines[source]; g = lines[source + 1]; b = lines[source + 2]; break
            case 4: r = g = b = lines[source]; a = lines[source + 1]; break
            case 6: r = lines[source]; g = lines[source + 1]; b = lines[source + 2]; a = lines[source + 3]; break
            case 3: {
                if (!palette) throw new Error("Indexed PNG has no PLTE chunk")
                const index = lines[source]
                r = palette[index * 3]
                g = palette[index * 3 + 1]
                b = palette[index * 3 + 2]
                a = transparency && index < transparency.length ? transparency[index] : 255
                break
            }
        }

        pixels[target] = r
        pixels[target + 1] = g
        pixels[target + 2] = b
        pixels[target + 3] = a
    }

    return { width, height, pixels }
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    if (pa <= pb && pa <= pc) return a
    return pb <= pc ? b : c
}

/*~~~ Sheet parsing ~~~*/

interface Options {
    columns: number
    rows: number // 0 = every complete row in the sheet
    first: number
    cellWidth: number
    cellHeight: number
    threshold: number
    name: string
    out: string | null
}

function isLit(image: Bitmap, x: number, y: number, threshold: number): boolean {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false

    const i = (y * image.width + x) * 4
    if (image.pixels[i + 3] < 128) return false // transparent counts as unlit

    // Rec. 601 luma - the sheet is light glyphs on a dark ground
    const luma = 0.299 * image.pixels[i] + 0.587 * image.pixels[i + 1] + 0.114 * image.pixels[i + 2]
    return luma >= threshold
}

/** Reads every cell as a boolean grid, keyed by the character it represents. */
function readCells(image: Bitmap, options: Options): Map<string, boolean[][]> {
    const { columns, first, cellWidth, cellHeight, threshold } = options

    // `rows` caps how far down the sheet to read, for sheets with a second
    // half that should be ignored. Partial trailing rows are skipped anyway.
    const available = Math.floor(image.height / cellHeight)
    const rows = options.rows > 0 ? Math.min(options.rows, available) : available
    const cells = new Map<string, boolean[][]>()

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
            const grid: boolean[][] = []

            for (let y = 0; y < cellHeight; y++) {
                const line: boolean[] = []
                for (let x = 0; x < cellWidth; x++) {
                    line.push(isLit(image, col * cellWidth + x, row * cellHeight + y, threshold))
                }
                grid.push(line)
            }

            cells.set(String.fromCharCode(first + row * columns + col), grid)
        }
    }

    return cells
}

/**
 * The tightest box that fits every glyph, so uniform padding baked into the
 * sheet is stripped without the glyphs losing their shared alignment.
 */
function commonBounds(cells: Map<string, boolean[][]>, cellWidth: number, cellHeight: number) {
    let left = cellWidth, top = cellHeight, right = -1, bottom = -1

    for (const grid of cells.values()) {
        for (let y = 0; y < cellHeight; y++) {
            for (let x = 0; x < cellWidth; x++) {
                if (!grid[y][x]) continue
                left = Math.min(left, x)
                right = Math.max(right, x)
                top = Math.min(top, y)
                bottom = Math.max(bottom, y)
            }
        }
    }

    if (right < 0) throw new Error("No lit pixels found - check --threshold, or the sheet may be dark-on-light")
    return { left, top, right, bottom }
}

function escapeKey(character: string): string {
    if (character === "\\") return '"\\\\"'
    if (character === '"') return '"\\""'
    return JSON.stringify(character)
}

function main() {
    const args = process.argv.slice(2)
    const file = args.find((a) => !a.startsWith("--"))
    if (!file) throw new Error("Usage: gen-font.ts <image.png> [--columns N] [--cell WxH] ...")

    const flag = (name: string) => {
        const i = args.indexOf(`--${name}`)
        return i >= 0 ? args[i + 1] : undefined
    }

    const image = decodePng(readFileSync(file))
    const columns = Number(flag("columns") ?? 16)

    // Cells are assumed to tile the sheet exactly, which is how these are made
    const inferred = Math.floor(image.width / columns)
    const [cellWidth, cellHeight] = (flag("cell") ?? `${inferred}x${inferred}`)
        .split("x")
        .map(Number)

    const options: Options = {
        columns,
        rows: Number(flag("rows") ?? 0),
        first: Number(flag("first") ?? 32),
        cellWidth,
        cellHeight,
        threshold: Number(flag("threshold") ?? 128),
        name: flag("name") ?? "GALACTIC_GLYPHS",
        out: flag("out") ?? null,
    }

    const cells = readCells(image, options)
    const bounds = commonBounds(cells, cellWidth, cellHeight)
    const glyphWidth = bounds.right - bounds.left + 1
    const glyphHeight = bounds.bottom - bounds.top + 1

    const lines: string[] = []
    for (const [character, grid] of cells) {
        const rows: string[] = []
        for (let y = bounds.top; y <= bounds.bottom; y++) {
            let row = ""
            for (let x = bounds.left; x <= bounds.right; x++) row += grid[y][x] ? "#" : "."
            rows.push(`"${row}"`)
        }
        lines.push(`    ${escapeKey(character)}: [${rows.join(", ")}],`)
    }

    const module = [
        `// Generated by dev/tools/gen-font.ts from ${file}`,
        `// ${glyphWidth}x${glyphHeight} glyphs, ${cells.size} of them. Do not edit by hand - re-run the tool.`,
        ``,
        `export const ${options.name}_WIDTH = ${glyphWidth}`,
        `export const ${options.name}_HEIGHT = ${glyphHeight}`,
        ``,
        `export const ${options.name}: Record<string, string[]> = {`,
        ...lines,
        `}`,
        ``,
    ].join("\n")

    console.error(
        `image ${image.width}x${image.height}, cell ${cellWidth}x${cellHeight}, ` +
        `glyph box ${glyphWidth}x${glyphHeight} at (${bounds.left}, ${bounds.top}), ` +
        `${cells.size} cells`
    )

    if (options.out) {
        writeFileSync(options.out, module)
        console.error(`wrote ${options.out}`)
    } else {
        console.log(module)
    }
}

main()
