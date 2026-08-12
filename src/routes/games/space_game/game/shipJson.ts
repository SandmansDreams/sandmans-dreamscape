import {
    canPlace,
    DEFAULT_KIND,
    isComponentKind,
    statsFor,
    type ComponentKind,
} from "../render/grid/components"
import type { Cell, Grid } from "../render/grid/grid"
import { SHIP_LAYERS, type ShipLayer } from "../render/grid/layers"
import { BLOCK_SHAPES, type BlockShape } from "../render/grid/shapes"
import { Color } from "../render/color"
import { Ship } from "./ship"

export const SHIP_FORMAT_VERSION = 4

/**
 * One block.
 *
 * Keys are short because these files get long, and everything except c/r/s is
 * omitted when it matches the default - a plain hull block is four keys.
 */
export interface ShipCellJson {
    c: number
    r: number
    s: string
    t?: number   // turns
    m?: boolean  // mirrored
    p?: string   // palette key
    e?: number   // emission
    k?: string   // component kind
    lv?: number  // level
    f?: number   // facing
    hp?: number  // hit points override
    ma?: number  // mass override
}

export interface ShipJson {
    version: number
    id: string
    name: string
    creator: string
    palette: Record<string, readonly number[]>
    layers: Partial<Record<ShipLayer, ShipCellJson[]>>
}

export interface ReadResult {
    ship: Ship
    /** Everything the file got wrong. Empty means a clean read. */
    warnings: string[]
}

const KNOWN_SHAPES: ReadonlySet<string> = new Set(BLOCK_SHAPES)

class PaletteWriter {
    private readonly byKey = new Map<string, Color>()

    /**
     * The key for a color, adding it if new.
     *
     * Keys are the color's hex digits rather than c0/c1, so the same color always
     * gets the same name and re-exporting after an unrelated edit produces a
     * stable diff instead of renumbering every entry.
     */
    keyFor(color: Color): string {
        // Color.hex already renders the digits; drop the leading hash
        const base = color.hex.replace("#", "")

        // Two colors can round to the same hex while differing as floats. Suffix
        // instead of letting the second silently overwrite the first.
        for (let attempt = 0; ; attempt++) {
            const key = attempt === 0 ? base : `${base}-${attempt}`
            const existing = this.byKey.get(key)

            if (!existing) {
                this.byKey.set(key, color)
                return key
            }
            if (existing.equals(color)) return key
        }
    }

    toJson(): Record<string, readonly number[]> {
        // Sorted so the palette does not reshuffle between exports. Written as
        // plain triples because JSON has no idea what a Color is.
        return Object.fromEntries(
            [...this.byKey].sort(([a], [b]) => a.localeCompare(b)).map(([key, color]) => [key, color.rgb]),
        )
    }
}

function cellToJson(cell: Cell, layer: ShipLayer, palette: PaletteWriter): ShipCellJson {
    const out: ShipCellJson = { c: cell.col, r: cell.row, s: cell.shape }

    if (cell.turns !== 0) out.t = cell.turns
    if (cell.mirrored) out.m = true
    out.p = palette.keyFor(cell.color)
    if (cell.emission !== 0) out.e = cell.emission
    if (cell.kind !== DEFAULT_KIND) out.k = cell.kind
    if (cell.level !== 1) out.lv = cell.level
    if (cell.facing !== 0) out.f = cell.facing

    const defaults = statsFor(cell.kind, cell.level)
    if (cell.hitPoints !== defaults.hitPoints) out.hp = cell.hitPoints
    // Cosmetic mass is forced to 0 on the way back in, so writing it is noise
    if (layer !== "cosmetic" && cell.mass !== defaults.mass) out.ma = cell.mass

    return out
}

export function shipToJson(ship: Ship): ShipJson {
    const palette = new PaletteWriter()
    const layers: Partial<Record<ShipLayer, ShipCellJson[]>> = {}

    for (const layer of SHIP_LAYERS) {
        // Sorted so the file is stable: Map iteration follows insertion order,
        // which would reshuffle the whole file after any edit
        const sorted = [...ship.layers[layer].list].sort((a, b) => a.row - b.row || a.col - b.col)
        layers[layer] = sorted.map((cell) => cellToJson(cell, layer, palette))
    }

    return {
        version: SHIP_FORMAT_VERSION,
        id: ship.id,
        name: ship.name,
        creator: ship.creator,
        palette: palette.toJson(),
        layers,
    }
}

/**
 * The file as text, one cell per line.
 *
 * JSON.stringify(x, null, 2) would give every key its own line, so a single
 * block becomes twelve lines and a hull becomes unreadable.
 */
export function shipToText(ship: Ship): string {
    const json = shipToJson(ship)
    const lines: string[] = ["{"]

    lines.push(`  "version": ${json.version},`)
    lines.push(`  "id": ${JSON.stringify(json.id)},`)
    lines.push(`  "name": ${JSON.stringify(json.name)},`)
    lines.push(`  "creator": ${JSON.stringify(json.creator)},`)

    const palette = Object.entries(json.palette).map(
        ([key, color]) => `    ${JSON.stringify(key)}: [${color.join(", ")}]`,
    )
    lines.push(palette.length === 0 ? `  "palette": {},` : `  "palette": {\n${palette.join(",\n")}\n  },`)

    const blocks = SHIP_LAYERS.map((layer) => {
        const cells = json.layers[layer] ?? []
        if (cells.length === 0) return `    ${JSON.stringify(layer)}: []`

        const body = cells.map((cell) => `      ${JSON.stringify(cell)}`).join(",\n")
        return `    ${JSON.stringify(layer)}: [\n${body}\n    ]`
    })
    lines.push(`  "layers": {\n${blocks.join(",\n")}\n  }`)

    lines.push("}")
    return lines.join("\n") + "\n"
}

/*~~~ Reading ~~~*/

function readPalette(raw: unknown, warnings: string[]): Map<string, Color> {
    const palette = new Map<string, Color>()
    if (raw == null || typeof raw !== "object") return palette

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (
            !Array.isArray(value) ||
            value.length !== 3 ||
            !value.every((channel) => typeof channel === "number" && Number.isFinite(channel))
        ) {
            warnings.push(`palette "${key}" is not three numbers, ignored`)
            continue
        }
        palette.set(key, Color.rgb(value[0], value[1], value[2]))
    }

    return palette
}

const FALLBACK_COLOR = Color.gray(0.6)

function readCell(
    grid: Grid,
    layer: ShipLayer,
    raw: unknown,
    palette: Map<string, Color>,
    warnings: string[],
): void {
    if (raw == null || typeof raw !== "object") {
        warnings.push(`${layer}: a cell is not an object, dropped`)
        return
    }

    const cell = raw as ShipCellJson
    const where = `${layer} (${cell.c}, ${cell.r})`

    if (!Number.isInteger(cell.c) || !Number.isInteger(cell.r)) {
        warnings.push(`${layer}: a cell has no integer c/r, dropped`)
        return
    }

    // A shape has no sensible fallback - anything else would silently change the
    // ship's outline, so this is the one case that drops the cell
    if (!KNOWN_SHAPES.has(cell.s)) {
        warnings.push(`${where}: unknown shape "${cell.s}", dropped`)
        return
    }

    let kind: ComponentKind = DEFAULT_KIND
    if (cell.k !== undefined) {
        if (isComponentKind(cell.k)) kind = cell.k
        else warnings.push(`${where}: unknown kind "${cell.k}", treated as ${DEFAULT_KIND}`)
    }

    // A rule violation is worth reporting but not worth deleting someone's work -
    // the editor is where placement gets enforced
    if (!canPlace(kind, layer)) warnings.push(`${where}: ${kind} is not allowed on the ${layer} layer`)

    let color = FALLBACK_COLOR
    if (cell.p !== undefined) {
        const found = palette.get(cell.p)
        if (found) color = found
        else warnings.push(`${where}: no palette entry "${cell.p}"`)
    }

    grid.set(cell.c, cell.r, cell.s as BlockShape, {
        turns: cell.t,
        mirrored: cell.m,
        color,
        emission: cell.e,
        kind,
        level: cell.lv,
        hitPoints: cell.hp,
        mass: cell.ma,
        facing: cell.f,
    })
}

/**
 * Reads a ship, reporting problems rather than throwing.
 *
 * A hand-edited file should lose one block, not the whole ship, so every failure
 * short of "this is not an object" degrades to a warning.
 */
export function readShip(data: unknown): ReadResult {
    const warnings: string[] = []
    const json = (data ?? {}) as Partial<ShipJson>

    if (json.version !== SHIP_FORMAT_VERSION) {
        warnings.push(`expected version ${SHIP_FORMAT_VERSION}, got ${String(json.version)}`)
    }

    const ship = new Ship(
        typeof json.id === "string" ? json.id : "untitled",
        typeof json.name === "string" ? json.name : "Untitled",
        typeof json.creator === "string" ? json.creator : "Unknown"
    )

    const palette = readPalette(json.palette, warnings)

    for (const layer of SHIP_LAYERS) {
        const cells = json.layers?.[layer]
        if (cells === undefined) continue

        if (!Array.isArray(cells)) {
            warnings.push(`layer "${layer}" is not an array, skipped`)
            continue
        }

        for (const raw of cells) readCell(ship.layers[layer], layer, raw, palette, warnings)
    }

    return { ship, warnings }
}

/** Parses text and reads it. Throws only when the text is not JSON at all. */
export function shipFromText(text: string): ReadResult {
    return readShip(JSON.parse(text))
}