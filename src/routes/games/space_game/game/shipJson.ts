import {
    canPlace,
    componentById,
    componentsOfKind,
    DEFAULT_TYPE,
    findComponent,
    isComponentKind,
    statsFor,
} from "../render/grid/components"
import type { Cell, Grid } from "../render/grid/grid"
import { SHIP_LAYERS, type ShipLayer } from "../render/grid/layers"
import { BLOCK_SHAPES, type BlockShape } from "../render/grid/shapes"
import { Color } from "../render/color"
import { Ship } from "./ship"
import { FALLBACK_COLOR, PaletteWriter, paletteLines, readPalette } from "./palette"

export const SHIP_FORMAT_VERSION = 7

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
    ty?: string  // component type, a registry id
    k?: string   // v5 and earlier: the category, before types existed
    lv?: number  // level
    f?: number   // facing
    hp?: number  // hit points override
    ma?: number  // mass override
    ac?: string  // accent palette key, absent when the art's own accent is used
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

/**
 * The component a cell names, migrating a v5 category if that is all it has.
 *
 * v5 and earlier stored `k`, the category, because there was exactly one thing
 * per category to store. The first type registered under a category is what
 * those cells become - which is why the order of `REGISTRY` is load-bearing for
 * old files, and why the plainest model of each category is listed first.
 */
function readType(cell: ShipCellJson, where: string, warnings: string[]): string {
    if (cell.ty !== undefined) {
        if (findComponent(cell.ty)) return cell.ty
        warnings.push(`${where}: unknown type "${cell.ty}", treated as ${DEFAULT_TYPE}`)
        return DEFAULT_TYPE
    }

    if (cell.k === undefined) return DEFAULT_TYPE

    // A category that has since become a type: `battery` was a kind of its own
    // before storage absorbed it, and the ships that shipped still say so. Tried
    // before the category lookup so nothing has to guess which it meant.
    if (!isComponentKind(cell.k)) {
        if (findComponent(cell.k)) return cell.k

        warnings.push(`${where}: unknown kind "${cell.k}", treated as ${DEFAULT_TYPE}`)
        return DEFAULT_TYPE
    }

    const migrated = componentsOfKind(cell.k)[0]
    if (migrated) return migrated.id

    // A category with no types registered under it: possible only mid-refactor,
    // but silently producing a hull block here would be a lie worth naming
    warnings.push(`${where}: no component of kind "${cell.k}", treated as ${DEFAULT_TYPE}`)
    return DEFAULT_TYPE
}

function cellToJson(cell: Cell, layer: ShipLayer, palette: PaletteWriter): ShipCellJson {
    const out: ShipCellJson = { c: cell.col, r: cell.row, s: cell.shape }

    if (cell.turns !== 0) out.t = cell.turns
    if (cell.mirrored) out.m = true
    out.p = palette.keyFor(cell.color)
    if (cell.emission !== 0) out.e = cell.emission
    if (cell.type !== DEFAULT_TYPE) out.ty = cell.type
    if (cell.level !== 1) out.lv = cell.level
    if (cell.facing !== 0) out.f = cell.facing
    // Absent means "whatever the art was drawn with", which is a real value and
    // not the same as any particular colour
    if (cell.accentColor !== null) out.ac = palette.keyFor(cell.accentColor)

    const defaults = statsFor(cell.type, cell.level)
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
    lines.push(`  "palette": ${paletteLines(json.palette)},`)

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

    const type = readType(cell, where, warnings)

    // A rule violation is worth reporting but not worth deleting someone's work -
    // the editor is where placement gets enforced
    if (!canPlace(type, layer)) {
        warnings.push(`${where}: ${componentById(type).name} is not allowed on the ${layer} layer`)
    }

    let color = FALLBACK_COLOR
    if (cell.p !== undefined) {
        const found = palette.get(cell.p)
        if (found) color = found
        else warnings.push(`${where}: no palette entry "${cell.p}"`)
    }

    let accentColor: Color | null = null
    if (cell.ac !== undefined) {
        const found = palette.get(cell.ac)
        if (found) accentColor = found
        else warnings.push(`${where}: no palette entry "${cell.ac}" for the accent`)
    }

    // Two legacy layers merged into one, so cells that never met can now want the
    // same square. Overwriting is still the outcome - the file is the record -
    // but doing it silently would hide a genuine loss.
    if (grid.has(cell.c, cell.r)) {
        warnings.push(`${where}: (${cell.c}, ${cell.r}) was already taken, overwritten`)
    }

    grid.set(cell.c, cell.r, cell.s as BlockShape, {
        turns: cell.t,
        mirrored: cell.m,
        color,
        emission: cell.e,
        type,
        level: cell.lv,
        hitPoints: cell.hp,
        mass: cell.ma,
        facing: cell.f,
        accentColor,
    })
}

/**
 * Layer names from older files, and where they land now.
 *
 * v6 and earlier split components across `coverable` (things a block was allowed
 * to cover) and `placement` (things it was not). Both fold into one layer.
 */
const LEGACY_LAYERS: Record<string, ShipLayer> = {
    coverable: "components",
    placement: "components",
}

/** The layer a file's key names, or null when it names nothing this build has. */
function resolveLayer(key: string): ShipLayer | null {
    if (SHIP_LAYERS.includes(key as ShipLayer)) return key as ShipLayer
    return LEGACY_LAYERS[key] ?? null
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

    // Driven by the file's keys rather than by SHIP_LAYERS: a key this build does
    // not know is the one case worth a warning, and the old loop passed over it
    // without a word
    for (const [key, cells] of Object.entries(json.layers ?? {})) {
        const layer = resolveLayer(key)
        if (layer === null) {
            warnings.push(`unknown layer "${key}", skipped`)
            continue
        }

        if (!Array.isArray(cells)) {
            warnings.push(`layer "${key}" is not an array, skipped`)
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