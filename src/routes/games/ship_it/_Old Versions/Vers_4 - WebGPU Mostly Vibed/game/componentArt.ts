// One piece of component art: authored cells, and the triangles they bake to

import { Color } from "../render/color"
import { ArtGrid } from "../render/grid/artGrid"
import { BLOCK_SHAPES, type BlockShape } from "../render/grid/shapes"
import {
    ART_LAYERS,
    ART_ROLES,
    bakeRole,
    compactCells,
    type ArtLayer,
    type ArtRole,
} from "../render/grid/spriteMesh"
import { FLOATS_PER_VERTEX } from "../render/mesh"
import { FALLBACK_COLOR, PaletteWriter, paletteLines, readPalette } from "./palette"

export const ART_FORMAT_VERSION = 3

/** The authoring canvas, in cells across. One hull cell's worth of art. */
export const ART_GRID = 16

/** Stand-ins until a placed component supplies its own. */
const DEFAULT_MAIN = "#4a90d9"
const DEFAULT_ACCENT = "#ffb347"

/**
 * One authored cell, or a run of identical ones.
 *
 * `role` and `layer` are omitted at their defaults - static and base - which is
 * both the common case and what keeps a plain square down to four keys. `p`
 * appears only on static cells: a main or accent square is recoloured by
 * whatever component wears the art, so storing a colour for it would be a
 * promise the game does not keep.
 */
export interface ArtCellJson {
    c: number
    r: number
    c2?: number
    r2?: number
    s: string
    t?: number
    m?: boolean
    role?: ArtRole
    layer?: ArtLayer
    p?: string
}

/** Baked triangles, split by layer and then by role. */
export type ArtMeshJson = Record<ArtLayer, Record<ArtRole, number[]>>

export interface ComponentArtJson {
    version: number
    id: string
    name: string
    grid: number
    /** Preview only, so reopening a piece looks how it was left. */
    mainColor: string
    accentColor: string
    palette: Record<string, readonly number[]>
    cells: ArtCellJson[]
    mesh: ArtMeshJson
}

export interface ComponentArt {
    id: string
    name: string
    grid: number
    mainColor: string
    accentColor: string
    /** One canvas per layer. Base draws first, top can be moved independently. */
    layers: Record<ArtLayer, ArtGrid>
    mesh: Record<ArtLayer, Record<ArtRole, Float32Array<ArrayBuffer>>>
}

export interface ReadArtResult {
    art: ComponentArt
    /** Everything the file got wrong. Empty means a clean read. */
    warnings: string[]
}

const KNOWN_SHAPES: ReadonlySet<string> = new Set(BLOCK_SHAPES)
const KNOWN_ROLES: ReadonlySet<string> = new Set(ART_ROLES)
const KNOWN_LAYERS: ReadonlySet<string> = new Set(ART_LAYERS)

/** An empty canvas, so a new piece and a read one have the same shape. */
export function emptyArt(id: string, name = id): ComponentArt {
    const layers = {} as Record<ArtLayer, ArtGrid>
    const mesh = {} as Record<ArtLayer, Record<ArtRole, Float32Array<ArrayBuffer>>>

    for (const layer of ART_LAYERS) {
        layers[layer] = new ArtGrid()

        const byRole = {} as Record<ArtRole, Float32Array<ArrayBuffer>>
        for (const role of ART_ROLES) byRole[role] = new Float32Array(0)
        mesh[layer] = byRole
    }

    return {
        id,
        name,
        grid: ART_GRID,
        mainColor: DEFAULT_MAIN,
        accentColor: DEFAULT_ACCENT,
        layers,
        mesh,
    }
}

/*~~~ Writing ~~~*/

export function artToJson(art: ComponentArt): ComponentArtJson {
    const palette = new PaletteWriter()
    const cells: ArtCellJson[] = []
    const mesh = {} as ArtMeshJson

    // Per layer then per role, so the file groups the way it draws and no
    // rectangle can ever span two of either
    for (const layer of ART_LAYERS) {
        const byRole = {} as Record<ArtRole, number[]>

        for (const role of ART_ROLES) {
            const list = art.layers[layer].ofRole(role)

            for (const rect of compactCells(list)) {
                const out: ArtCellJson = { c: rect.col, r: rect.row, s: rect.cell.shape }

                if (rect.col2 !== rect.col) out.c2 = rect.col2
                if (rect.row2 !== rect.row) out.r2 = rect.row2
                if (rect.cell.turns !== 0) out.t = rect.cell.turns
                if (rect.cell.mirrored) out.m = true
                if (role !== "static") out.role = role
                else out.p = palette.keyFor(rect.cell.color)
                if (layer !== "base") out.layer = layer

                cells.push(out)
            }

            byRole[role] = Array.from(bakeRole(list, art.grid))
        }

        mesh[layer] = byRole
    }

    return {
        version: ART_FORMAT_VERSION,
        id: art.id,
        name: art.name,
        grid: art.grid,
        mainColor: art.mainColor,
        accentColor: art.accentColor,
        // Built last: keyFor is what filled it, so it has to run after the loop
        palette: palette.toJson(),
        cells,
        mesh,
    }
}

/**
 * The file as text, one cell per line.
 *
 * JSON.stringify(x, null, 2) would give every key its own line, so a single
 * square becomes eight lines and a sprite becomes unreadable. The mesh is the
 * exception - it is generated, nobody edits it, and one float per line would be
 * thousands of lines.
 */
export function artToText(art: ComponentArt): string {
    const json = artToJson(art)
    const lines: string[] = ["{"]

    lines.push(`  "version": ${json.version},`)
    lines.push(`  "id": ${JSON.stringify(json.id)},`)
    lines.push(`  "name": ${JSON.stringify(json.name)},`)
    lines.push(`  "grid": ${json.grid},`)
    lines.push(`  "mainColor": ${JSON.stringify(json.mainColor)},`)
    lines.push(`  "accentColor": ${JSON.stringify(json.accentColor)},`)
    lines.push(`  "palette": ${paletteLines(json.palette)},`)

    const cells = json.cells.map((cell) => `    ${JSON.stringify(cell)}`)
    lines.push(cells.length === 0 ? `  "cells": [],` : `  "cells": [\n${cells.join(",\n")}\n  ],`)

    const layers = ART_LAYERS.map((layer) => {
        const roles = ART_ROLES.map(
            (role) => `      ${JSON.stringify(role)}: [${json.mesh[layer][role].join(",")}]`,
        )
        return `    ${JSON.stringify(layer)}: {\n${roles.join(",\n")}\n    }`
    })
    lines.push(`  "mesh": {\n${layers.join(",\n")}\n  }`)

    lines.push("}")
    return lines.join("\n") + "\n"
}

/*~~~ Reading ~~~*/

function readCell(
    grid: ArtGrid,
    where: string,
    raw: unknown,
    role: ArtRole,
    palette: Map<string, Color>,
    warnings: string[],
): void {
    if (raw == null || typeof raw !== "object") {
        warnings.push(`${where}: not an object, skipped`)
        return
    }

    const cell = raw as ArtCellJson

    if (!Number.isInteger(cell.c) || !Number.isInteger(cell.r)) {
        warnings.push(`${where}: c and r must be whole numbers, skipped`)
        return
    }

    if (!KNOWN_SHAPES.has(cell.s)) {
        warnings.push(`${where}: unknown shape "${cell.s}", skipped`)
        return
    }

    let color = FALLBACK_COLOR
    if (cell.p !== undefined) {
        const found = palette.get(cell.p)
        if (found) color = found
        else warnings.push(`${where}: no palette entry "${cell.p}"`)
    }

    // fill covers the single-cell case, so c2/r2 need no branch here
    grid.fill(cell.c, cell.r, cell.c2 ?? cell.c, cell.r2 ?? cell.r, cell.s as BlockShape, {
        turns: cell.t,
        mirrored: cell.m,
        role,
        color,
    })
}

/** The role an entry declares, defaulting to static as the writer assumes. */
function roleOf(raw: unknown, where: string, warnings: string[]): ArtRole {
    const declared = (raw as ArtCellJson)?.role
    if (declared === undefined) return "static"

    if (!KNOWN_ROLES.has(declared)) {
        warnings.push(`${where}: unknown role "${declared}", treated as static`)
        return "static"
    }

    return declared
}

/** The layer an entry declares, defaulting to base as the writer assumes. */
function layerOf(raw: unknown, where: string, warnings: string[]): ArtLayer {
    const declared = (raw as ArtCellJson)?.layer
    if (declared === undefined) return "base"

    if (!KNOWN_LAYERS.has(declared)) {
        warnings.push(`${where}: unknown layer "${declared}", treated as base`)
        return "base"
    }

    return declared
}

/**
 * Version 1 kept three separate cell arrays, one per role.
 *
 * Roles are read in draw order, so where a v1 accent square sat on top of a main
 * one the accent wins - which is what it looked like at the time. Reading them
 * in any other order would silently change art that was already drawn.
 */
function readLegacyCells(
    art: ComponentArt,
    raw: unknown,
    palette: Map<string, Color>,
    warnings: string[],
): void {
    const byRole = (raw ?? {}) as Partial<Record<ArtRole, unknown>>

    for (const role of ART_ROLES) {
        const entries = byRole[role]
        if (entries === undefined) continue

        if (!Array.isArray(entries)) {
            warnings.push(`v1 role "${role}" is not an array, skipped`)
            continue
        }

        // Everything a v1 file holds is structure, not animation, so it all lands
        // on base and the top layer starts empty
        entries.forEach((cell, index) => {
            readCell(art.layers.base, `${role}[${index}]`, cell, role, palette, warnings)
        })

        // The first colour a tinted role wore becomes the piece's preview, so a
        // migrated file still looks the way it did when it was drawn
        const first = (entries[0] as ArtCellJson | undefined)?.p
        const color = first ? palette.get(first) : undefined
        if (!color) continue

        if (role === "main") art.mainColor = color.hex
        if (role === "accent") art.accentColor = color.hex
    }
}

/**
 * Reads a piece of art, reporting problems rather than throwing.
 *
 * The stored mesh is used when it is well formed and re-baked from the cells
 * when it is not. Keeping it in the file lets a consumer skip the geometry code
 * entirely; re-baking on doubt means a hand-edited or half-written file can
 * never draw something the cells do not say.
 */
export function readArt(data: unknown): ReadArtResult {
    const warnings: string[] = []
    const json = (data ?? {}) as Partial<ComponentArtJson>

    const art = emptyArt(
        typeof json.id === "string" ? json.id : "untitled",
        typeof json.name === "string" ? json.name : "Untitled",
    )
    art.grid = Number.isInteger(json.grid) && json.grid! > 0 ? json.grid! : ART_GRID
    if (typeof json.mainColor === "string") art.mainColor = json.mainColor
    if (typeof json.accentColor === "string") art.accentColor = json.accentColor

    const palette = readPalette(json.palette, warnings)

    if (Array.isArray(json.cells)) {
        // v2 and v3 share this shape; a v2 entry simply never names a layer, and
        // base is exactly where its squares belong
        json.cells.forEach((raw, index) => {
            const where = `cells[${index}]`
            const layer = layerOf(raw, where, warnings)
            readCell(art.layers[layer], where, raw, roleOf(raw, where, warnings), palette, warnings)
        })
    } else if (json.cells !== undefined) {
        readLegacyCells(art, json.cells, palette, warnings)
    }

    // After the version-specific branches: an unreadable version still gets the
    // best read available rather than an empty piece
    if (json.version !== ART_FORMAT_VERSION) {
        warnings.push(`expected version ${ART_FORMAT_VERSION}, got ${String(json.version)}`)
    }

    readMesh(art, json.mesh)

    return { art, warnings }
}

/**
 * Takes the stored triangles where they are usable, re-bakes where they are not.
 *
 * An older file's mesh is not nested by layer, so none of it is usable and every
 * role re-bakes - which is right, because the cells have just been read into a
 * layer the old mesh knew nothing about.
 */
function readMesh(art: ComponentArt, raw: unknown): void {
    const stored = (raw ?? {}) as Partial<ArtMeshJson>

    for (const layer of ART_LAYERS) {
        for (const role of ART_ROLES) {
            art.mesh[layer][role] = usableMesh(stored[layer]?.[role])
                ?? bakeRole(art.layers[layer].ofRole(role), art.grid)
        }
    }
}

/** A stored mesh, when it is whole triangles of whole vertices. Otherwise null. */
function usableMesh(raw: unknown): Float32Array<ArrayBuffer> | null {
    if (!Array.isArray(raw) || raw.length === 0) return null
    if (raw.length % (FLOATS_PER_VERTEX * 3) !== 0) return null
    if (!raw.every((n) => typeof n === "number" && Number.isFinite(n))) return null

    return new Float32Array(raw)
}

/** Parses text and reads it. Throws only when the text is not JSON at all. */
export function artFromText(text: string): ReadArtResult {
    return readArt(JSON.parse(text))
}
