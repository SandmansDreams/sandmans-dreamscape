import { describe, expect, it } from "vitest"
import { Color } from "../render/color"
import { ART_LAYERS, ART_ROLES } from "../render/grid/spriteMesh"
import { FLOATS_PER_VERTEX } from "../render/mesh"
import {
    artFromText,
    artToJson,
    artToText,
    emptyArt,
    readArt,
    ART_GRID,
    type ComponentArt,
} from "./componentArt"

const STEEL = Color.from("#545454")
const BRASS = Color.from("#b98c3a")

/**
 * A piece using both layers, all three roles, a merged run and an unmergeable
 * shape - so one fixture exercises every branch the writer has.
 */
function sample(): ComponentArt {
    const art = emptyArt("turret-light", "Light Turret")
    art.mainColor = "#112233"
    art.accentColor = "#445566"

    art.layers.base.fill(2, 2, 5, 5, "full", { role: "static", color: STEEL })
    art.layers.base.fill(6, 2, 9, 5, "full", { role: "main" })
    art.layers.base.set(2, 6, "arc", { turns: 2, role: "accent" })

    // The barrel: on top so it can be swung without moving the mounting
    art.layers.top.fill(0, 14, 3, 14, "full", { role: "static", color: BRASS })

    return art
}

function triangleCount(data: readonly number[]): number {
    return data.length / (FLOATS_PER_VERTEX * 3)
}

describe("artToJson", () => {
    it("marks tinted cells with a role and leaves static implicit", () => {
        const json = artToJson(sample())

        const roles = json.cells.map((cell) => cell.role ?? "static")
        expect(roles).toContain("static")
        expect(roles).toContain("main")
        expect(roles).toContain("accent")
    })

    it("marks top cells with a layer and leaves base implicit", () => {
        const json = artToJson(sample())

        const top = json.cells.filter((cell) => cell.layer === "top")
        expect(top).toHaveLength(1)
        expect(top[0]).toMatchObject({ c: 0, r: 14, c2: 3 })

        // Base is the default, so nothing on it should carry the key at all
        const base = json.cells.filter((cell) => cell.layer === undefined)
        expect(base).toHaveLength(3)
    })

    it("gives a palette key to static cells and none to tinted ones", () => {
        const json = artToJson(sample())

        for (const cell of json.cells) {
            // A tinted square is recoloured by whatever wears the art, so a
            // colour on it would be a promise the game does not keep
            if (cell.role === undefined) expect(cell.p).toBeDefined()
            else expect(cell.p).toBeUndefined()
        }
    })

    it("writes a merged run as one rectangle", () => {
        const json = artToJson(sample())
        const statics = json.cells.filter(
            (cell) => cell.role === undefined && cell.layer === undefined,
        )

        // 16 authored squares, one line
        expect(statics).toHaveLength(1)
        expect(statics[0]).toMatchObject({ c: 2, r: 2, c2: 5, r2: 5 })
    })

    it("bakes each layer and role on its own", () => {
        const json = artToJson(sample())

        expect(triangleCount(json.mesh.base.static)).toBe(2)
        expect(triangleCount(json.mesh.base.main)).toBe(2)
        // An arc is a fan, so it stays whatever appendShape emitted
        expect(triangleCount(json.mesh.base.accent)).toBeGreaterThan(2)

        expect(triangleCount(json.mesh.top.static)).toBe(2)
        expect(json.mesh.top.main).toHaveLength(0)
        expect(json.mesh.top.accent).toHaveLength(0)
    })

    it("never merges a run across the layer boundary", () => {
        const art = emptyArt("seam")
        // Same colour, same shape, touching - everything but the layer agrees
        art.layers.base.fill(0, 0, 3, 0, "full", { role: "static", color: STEEL })
        art.layers.top.fill(4, 0, 7, 0, "full", { role: "static", color: STEEL })

        const json = artToJson(art)

        expect(json.cells).toHaveLength(2)
        expect(triangleCount(json.mesh.base.static)).toBe(2)
        expect(triangleCount(json.mesh.top.static)).toBe(2)
    })

    it("keeps only static colours in the palette", () => {
        const json = artToJson(sample())

        expect(Object.keys(json.palette).sort()).toEqual(["545454", "b98c3a"])
    })
})

describe("round trip", () => {
    it("keeps the identity and the preview colours", () => {
        const { art, warnings } = artFromText(artToText(sample()))

        expect(warnings).toEqual([])
        expect(art.id).toBe("turret-light")
        expect(art.name).toBe("Light Turret")
        expect(art.grid).toBe(ART_GRID)
        expect(art.mainColor).toBe("#112233")
        expect(art.accentColor).toBe("#445566")
    })

    it("keeps every cell on the layer and role it was drawn on", () => {
        const { art } = artFromText(artToText(sample()))

        expect(art.layers.base.ofRole("static")).toHaveLength(16)
        expect(art.layers.base.ofRole("main")).toHaveLength(16)
        expect(art.layers.base.ofRole("accent")).toHaveLength(1)
        expect(art.layers.base.size).toBe(33)

        expect(art.layers.top.ofRole("static")).toHaveLength(4)
        expect(art.layers.top.size).toBe(4)
    })

    it("lets both layers hold a square at the same position", () => {
        const art = emptyArt("stacked")
        art.layers.base.set(8, 8, "full", { role: "static", color: STEEL })
        art.layers.top.set(8, 8, "wedge", { turns: 1, role: "accent" })

        const { art: again } = artFromText(artToText(art))

        expect(again.layers.base.get(8, 8)!.shape).toBe("full")
        expect(again.layers.top.get(8, 8)!.shape).toBe("wedge")
    })

    it("keeps shape, orientation and static colour", () => {
        const { art } = artFromText(artToText(sample()))

        const arc = art.layers.base.get(2, 6)!
        expect(arc.shape).toBe("arc")
        expect(arc.turns).toBe(2)
        expect(arc.role).toBe("accent")

        expect(art.layers.base.get(3, 3)!.color.hex).toBe(STEEL.hex)
        expect(art.layers.base.get(7, 3)!.role).toBe("main")
        expect(art.layers.top.get(1, 14)!.color.hex).toBe(BRASS.hex)
    })
})

describe("readArt leniency", () => {
    it("drops an unknown shape and says so", () => {
        const json = artToJson(sample())
        json.cells.push({ c: 0, r: 15, s: "trapezoid", p: "545454" })

        const { art, warnings } = readArt(json)

        expect(art.layers.base.get(0, 15)).toBeUndefined()
        expect(warnings.join(" ")).toContain("trapezoid")
    })

    it("treats an unknown role as static and says so", () => {
        const json = artToJson(sample())
        json.cells.push({ c: 0, r: 15, s: "full", role: "glow" as never })

        const { art, warnings } = readArt(json)

        expect(art.layers.base.get(0, 15)!.role).toBe("static")
        expect(warnings.join(" ")).toContain("glow")
    })

    it("treats an unknown layer as base and says so", () => {
        const json = artToJson(sample())
        json.cells.push({ c: 0, r: 15, s: "full", layer: "overlay" as never })

        const { art, warnings } = readArt(json)

        expect(art.layers.base.get(0, 15)).toBeDefined()
        expect(warnings.join(" ")).toContain("overlay")
    })

    it("re-bakes when a stored mesh is not whole triangles", () => {
        const json = artToJson(sample())
        json.mesh.base.static = [1, 2, 3]

        const { art } = readArt(json)

        expect(art.mesh.base.static.length % (FLOATS_PER_VERTEX * 3)).toBe(0)
        expect(triangleCount([...art.mesh.base.static])).toBe(2)
    })

    it("falls back to the default grid when it is nonsense", () => {
        const json = artToJson(sample())
        json.grid = 0

        expect(readArt(json).art.grid).toBe(ART_GRID)
    })

    it("survives a file that is barely a file", () => {
        const { art, warnings } = readArt({})

        expect(warnings.length).toBeGreaterThan(0)

        for (const layer of ART_LAYERS) {
            expect(art.layers[layer].size).toBe(0)
            for (const role of ART_ROLES) expect(art.mesh[layer][role]).toHaveLength(0)
        }
    })
})

describe("v2 migration", () => {
    /** A flat, roled file from before the top layer existed. */
    function flat() {
        return {
            version: 2,
            id: "crate", name: "Crate", grid: 16,
            mainColor: "#112233", accentColor: "#445566",
            palette: { "545454": [0.329412, 0.329412, 0.329412] },
            cells: [
                { c: 0, r: 0, s: "full", c2: 3, p: "545454" },
                { c: 0, r: 1, s: "full", role: "main" },
            ],
            mesh: { static: [], main: [], accent: [] },
        }
    }

    it("puts every v2 square on the base layer", () => {
        const { art } = readArt(flat())

        expect(art.layers.base.size).toBe(5)
        expect(art.layers.top.size).toBe(0)
    })

    it("re-bakes, since a v2 mesh is not keyed by layer", () => {
        const { art } = readArt(flat())

        expect(triangleCount([...art.mesh.base.static])).toBe(2)
        expect(triangleCount([...art.mesh.base.main])).toBe(2)
    })

    it("says which version it found", () => {
        expect(readArt(flat()).warnings.join(" ")).toContain("got 2")
    })
})

describe("v1 migration", () => {
    /** The shape the format had when the first turrets were drawn. */
    function legacy() {
        return {
            version: 1,
            id: "turret", name: "Turret", grid: 16,
            palette: {
                "545454": [0.329412, 0.329412, 0.329412],
                "94a1b3": [0.580392, 0.631373, 0.701961],
            },
            cells: {
                static: [{ c: 0, r: 0, s: "full", p: "545454" }],
                main: [{ c: 1, r: 0, s: "full", c2: 4, p: "94a1b3" }],
                accent: [{ c: 0, r: 1, s: "wedge", t: 2, p: "545454" }],
            },
            mesh: { static: [], main: [], accent: [] },
        }
    }

    it("folds three arrays into one roled list on the base layer", () => {
        const { art } = readArt(legacy())

        expect(art.layers.base.ofRole("static")).toHaveLength(1)
        expect(art.layers.base.ofRole("main")).toHaveLength(4)
        expect(art.layers.base.ofRole("accent")).toHaveLength(1)
        expect(art.layers.base.get(2, 0)!.role).toBe("main")

        // Nothing in a v1 file is animation, so the top layer starts empty
        expect(art.layers.top.size).toBe(0)
    })

    it("lifts a tinted role's colour to the piece", () => {
        // v1 stored a preview colour per cell; later versions keep one per piece,
        // so a migrated file still looks how it was drawn
        const { art } = readArt(legacy())

        expect(art.mainColor.toLowerCase()).toBe("#94a1b3")
    })

    it("keeps the expanded run expanded", () => {
        const { art } = readArt(legacy())

        for (let col = 1; col <= 4; col++) {
            expect(art.layers.base.get(col, 0)!.role).toBe("main")
        }
    })

    it("says which version it found", () => {
        const { warnings } = readArt(legacy())
        expect(warnings.join(" ")).toContain("got 1")
    })

    it("re-exports as the current version", () => {
        const { art } = readArt(legacy())
        const { art: again, warnings } = artFromText(artToText(art))

        // Clean on the second pass: the migration is a one-way door
        expect(warnings).toEqual([])
        expect(again.layers.base.size).toBe(6)
    })
})
