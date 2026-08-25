// Writing a ship back into assets/ships, so the editor can save in place

import { dev } from "$app/environment"
import { error, json } from "@sveltejs/kit"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { RequestHandler } from "./$types"

/** Where the ship glob looks. Relative to the project root, which is cwd in dev. */
const SHIPS = "src/routes/games/space_game/assets/ships"

/**
 * Lowercase, digits and dashes: exactly what a ship id already looks like.
 *
 * A whitelist rather than a check for "..", because the point is not to catch
 * the traversal someone thought of - it is that a filename built from a request
 * should only ever be able to name a file in one folder.
 */
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * Overwrites one ship file with the text the builder sends.
 *
 * Dev only, and not because it is unfinished: this writes to the source tree.
 * There is no such tree in a build, and an endpoint that takes a filename and
 * some text and puts them on disk is not something to ship even disabled.
 *
 * The reply is deliberately dull - the builder shows a notice and the file glob
 * reloads the ship on its own, so there is nothing to hand back.
 */
export const POST: RequestHandler = async ({ request }) => {
    if (!dev) throw error(403, "Saving ships is a development-only convenience.")

    const body = await request.json().catch(() => null) as { id?: unknown; text?: unknown } | null

    const id = typeof body?.id === "string" ? body.id : ""
    const text = typeof body?.text === "string" ? body.text : ""

    if (!SAFE_ID.test(id)) throw error(400, `"${id}" is not a usable ship id.`)
    if (text.trim() === "") throw error(400, "Refusing to write an empty ship file.")

    await writeFile(join(process.cwd(), SHIPS, `${id}.json`), text, "utf8")

    return json({ saved: `${id}.json` })
}
