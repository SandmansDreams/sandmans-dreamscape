import { readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { HullCell, HullData } from "../hull"
import { convertLegacyHull, type LegacyHull } from "./legacyHull"

/**
 * Command-line front end for the legacy hull converter.
 *
 *   npm run convert-hull -- ~/Downloads/ScytheShip.json
 *   npm run convert-hull -- "~/Downloads/my-ship 2.json" --id myShip2 --name "My Ship 2"
 *
 * Writes into engine/hulls/, where the registry picks it up automatically.
 * The node:fs import lives here rather than in legacyHull.ts so nothing that
 * runs in the browser or under Vitest pulls it in.
 */

const HULLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../hulls")

/** "my-ship 2 (1).json" to "myShip2" — a usable module id from a messy filename. */
function idFromFilename(path: string): string {
    const stem = basename(path).replace(/\.json$/i, "")

    const words = stem
        .replace(/\(\d+\)/g, " ")       // the browser's duplicate-download suffix
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)

    return words
        .map((word, index) => index === 0
            ? word[0].toLowerCase() + word.slice(1)
            : word[0].toUpperCase() + word.slice(1))
        .join("")
}

/** Title-cases an id for the picker label: "myShip2" to "My Ship 2". */
function labelFromId(id: string): string {
    return id
        .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
        .replace(/^./, first => first.toUpperCase())
}

/**
 * Writes each cell on its own line.
 *
 * `JSON.stringify(data, null, 2)` explodes every cell across seven lines, which
 * makes a hull unreadable. The palette gets the same treatment.
 */
function format(hull: HullData): string {
    const palette = Object.entries(hull.palette)
        .map(([key, rgb]) => `    ${JSON.stringify(key)}: ${JSON.stringify(rgb)}`)
        .join(",\n")

    const cells = hull.cells
        .map((cell: HullCell) => `    ${JSON.stringify(cell)}`)
        .join(",\n")

    return [
        "{",
        `  "version": ${hull.version},`,
        `  "name": ${JSON.stringify(hull.name ?? "")},`,
        `  "palette": {\n${palette}\n  },`,
        `  "cells": [\n${cells}\n  ]`,
        "}",
        ""
    ].join("\n")
}

function main() {
    const args = process.argv.slice(2)
    const sources: string[] = []

    let id: string | undefined
    let name: string | undefined

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--id") id = args[++i]
        else if (args[i] === "--name") name = args[++i]
        else sources.push(args[i])
    }

    if (sources.length === 0) {
        console.error("usage: npm run convert-hull -- <legacy.json>... [--id x] [--name \"X\"]")
        process.exit(1)
    }

    if (sources.length > 1 && (id || name)) {
        console.error("--id and --name apply to a single file")
        process.exit(1)
    }

    for (const source of sources) {
        const path = resolve(source.replace(/^~/, process.env.HOME ?? "~"))
        const legacy = JSON.parse(readFileSync(path, "utf8")) as LegacyHull

        const outId = id ?? idFromFilename(path)
        const { hull, warnings, cellCount } = convertLegacyHull(legacy, name ?? labelFromId(outId))

        const target = resolve(HULLS_DIR, `${outId}.json`)
        writeFileSync(target, format(hull))

        const colours = Object.keys(hull.palette).length
        console.log(
            `${basename(path)} -> hulls/${outId}.json  ` +
            `${cellCount} cells in ${hull.cells.length} entries, ${colours} colours`
        )
        for (const warning of warnings) console.log(`  ! ${warning}`)
    }
}

main()
