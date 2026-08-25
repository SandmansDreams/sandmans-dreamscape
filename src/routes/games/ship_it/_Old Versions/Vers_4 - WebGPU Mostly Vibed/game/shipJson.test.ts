import { describe, expect, it } from "vitest"
import { Color } from "../render/color"
import { Ship } from "./ship"
import { readShip, shipFromText, shipToJson, shipToText, SHIP_FORMAT_VERSION } from "./shipJson"

function sample(): Ship {
    const ship = new Ship("test", "Test Ship")

    ship.layers.hull.set(0, 0, "full", { color: Color.rgb(0.58, 0.63, 0.7) })
    ship.layers.hull.set(1, 0, "wedge", { turns: 2, color: Color.rgb(0.58, 0.63, 0.7) })
    ship.layers.hull.set(-1, 0, "halfWedge", { mirrored: true, color: Color.rgb(0.26, 0.29, 0.34) })
    ship.layers.components.set(0, 1, "full", {
        type: "ion-thruster",
        facing: 2,
        emission: 0.8,
        color: Color.rgb(0.26, 0.29, 0.34),
    })
    ship.layers.cosmetic.set(0, -1, "centerLine", { color: Color.rgb(0.35, 0.85, 1) })

    return ship
}

describe("shipToJson()", () => {
    it("omits every default", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full", { color: Color.rgb(1, 1, 1) })

        const cell = shipToJson(ship).layers.hull![0]!
        // c, r, s and the palette key - nothing else
        expect(Object.keys(cell).sort()).toEqual(["c", "p", "r", "s"])
    })

    it("writes only the fields that differ from the defaults", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(2, 3, "wedge", { turns: 1, mirrored: true, hitPoints: 99, color: Color.rgb(1, 1, 1) })

        const cell = shipToJson(ship).layers.hull![0]!
        expect(cell).toMatchObject({ c: 2, r: 3, s: "wedge", t: 1, m: true, hp: 99 })
        expect(cell.lv).toBeUndefined()
        expect(cell.f).toBeUndefined()
    })

    it("names palette entries by their hex digits", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full", { color: Color.rgb(0.58, 0.63, 0.7) })

        expect(Object.keys(shipToJson(ship).palette)).toEqual(["94a1b3"])
    })

    it("keeps two near-identical colors apart", () => {
        const ship = new Ship("t", "T")
        // Both round to the same hex, so a naive writer would merge them
        ship.layers.hull.set(0, 0, "full", { color: Color.rgb(0.58, 0.63, 0.7) })
        ship.layers.hull.set(1, 0, "full", { color: Color.rgb(0.5801, 0.63, 0.7) })

        expect(Object.keys(shipToJson(ship).palette)).toHaveLength(2)
    })

    it("does not write cosmetic mass, which is forced to zero on the way back", () => {
        const ship = new Ship("t", "T")
        ship.layers.cosmetic.set(0, 0, "full", { color: Color.rgb(1, 1, 1) })

        expect(shipToJson(ship).layers.cosmetic![0]!.ma).toBeUndefined()
    })
})

describe("round trip", () => {
    it("survives write, read and write again byte for byte", () => {
        const first = shipToText(sample())
        const second = shipToText(shipFromText(first).ship)

        expect(second).toBe(first)
    })

    it("preserves ids, names and cell contents", () => {
        const { ship, warnings } = shipFromText(shipToText(sample()))

        expect(warnings).toEqual([])
        expect(ship.id).toBe("test")
        expect(ship.name).toBe("Test Ship")

        const thruster = ship.layers.components.get(0, 1)!
        expect(thruster.type).toBe("ion-thruster")
        expect(thruster.facing).toBe(2)
        expect(thruster.emission).toBe(0.8)

        expect(ship.layers.hull.get(-1, 0)!.mirrored).toBe(true)
        expect(ship.layers.hull.get(1, 0)!.turns).toBe(2)
    })

    it("carries a thruster kept out of the steering group", () => {
        const ship = sample()
        ship.layers.components.set(0, 2, "full", { type: "ion-thruster", steering: false })

        const { ship: read } = shipFromText(shipToText(ship))

        expect(read.layers.components.get(0, 2)!.steering).toBe(false)
        // The default survives untouched alongside it
        expect(read.layers.components.get(0, 1)!.steering).toBe(true)
    })

    it("reads a file written before steering existed as all-steering", () => {
        // v7 and earlier have no `st` key, and absent has to keep meaning yes -
        // otherwise every ship on disk quietly loses the ability to turn
        const { ship, warnings } = readShip({
            version: SHIP_FORMAT_VERSION,
            id: "old", name: "Old", creator: "",
            palette: {},
            layers: { components: [{ c: 0, r: 0, s: "full", ty: "ion-thruster", f: 2 }] },
        })

        expect(warnings).toEqual([])
        expect(ship.layers.components.get(0, 0)!.steering).toBe(true)
    })

    it("writes one cell per line", () => {
        const hullLines = shipToText(sample())
            .split("\n")
            .filter((line) => line.trimStart().startsWith(`{"c":`))

        expect(hullLines).toHaveLength(5)
    })
})

describe("readShip() leniency", () => {
    it("drops a cell with an unknown shape and says so", () => {
        const { ship, warnings } = readShip({
            version: SHIP_FORMAT_VERSION,
            id: "t",
            name: "T",
            palette: {},
            layers: { hull: [{ c: 0, r: 0, s: "full" }, { c: 1, r: 0, s: "banana" }] },
        })

        expect(ship.layers.hull.size).toBe(1)
        expect(warnings.some((w) => w.includes("banana"))).toBe(true)
    })

    it("falls back to the default type for an unknown one rather than dropping the block", () => {
        const { ship, warnings } = readShip({
            version: SHIP_FORMAT_VERSION,
            layers: { hull: [{ c: 0, r: 0, s: "full", ty: "warp-core" }] },
        })

        expect(ship.layers.hull.get(0, 0)!.type).toBe("hull-plate")
        expect(warnings.some((w) => w.includes("warp-core"))).toBe(true)
    })

    it("reports a wrong version but still reads the ship", () => {
        const { ship, warnings } = readShip({
            version: 1,
            layers: { hull: [{ c: 0, r: 0, s: "full" }] },
        })

        expect(ship.layers.hull.size).toBe(1)
        expect(warnings.some((w) => w.includes("version"))).toBe(true)
    })

    it("does not throw on rubbish", () => {
        expect(() => readShip(null)).not.toThrow()
        expect(() => readShip({ layers: { hull: "nope" } })).not.toThrow()
    })
})

describe("v5 migration", () => {
    /** A file from when a cell named its category and there was one thing in it. */
    function v5() {
        return {
            version: 5,
            id: "old", name: "Old", creator: "SpaceGameCreator",
            palette: {},
            layers: {
                hull: [{ c: 0, r: 0, s: "full" }],
                coverable: [
                    { c: 0, r: 1, s: "full", k: "thruster", f: 2 },
                    { c: 1, r: 1, s: "full", k: "storage" },
                ],
            },
        }
    }

    it("turns a category into the first type registered under it", () => {
        const { ship } = readShip(v5())

        expect(ship.layers.components.get(0, 1)!.type).toBe("ion-thruster")
        expect(ship.layers.components.get(1, 1)!.type).toBe("crate")
    })

    it("rescues a category that has since become a type", () => {
        // The shipped ships still say k:"battery" from before storage absorbed
        // it. Reading that as "unknown" would turn every battery into hull.
        const { ship, warnings } = readShip({
            version: 4,
            layers: { coverable: [{ c: 0, r: 0, s: "full", k: "battery" }] },
        })

        expect(ship.layers.components.get(0, 0)!.type).toBe("battery")
        expect(warnings.some((w) => w.includes("battery"))).toBe(false)
    })

    it("keeps a cell that named no category on the default type", () => {
        const { ship } = readShip(v5())

        expect(ship.layers.hull.get(0, 0)!.type).toBe("hull-plate")
    })

    it("keeps every block, which is what a lost migration would cost", () => {
        const { ship } = readShip(v5())

        expect(ship.layers.hull.size).toBe(1)
        expect(ship.layers.components.size).toBe(2)
    })

    it("carries the migrated cell's stats from its new type", () => {
        const { ship } = readShip(v5())
        const thruster = ship.layers.components.get(0, 1)!

        // An ion thruster at level 1, not whatever the old category table said
        expect(thruster.hitPoints).toBe(8)
        expect(thruster.facing).toBe(2)
    })

    it("re-exports as the current version, cleanly", () => {
        const { ship } = readShip(v5())
        const { ship: again, warnings } = readShip(shipToJson(ship))

        expect(warnings).toEqual([])
        expect(again.layers.components.get(0, 1)!.type).toBe("ion-thruster")
    })

    it("folds both old component layers into one", () => {
        const { ship, warnings } = readShip({
            version: 6,
            layers: {
                coverable: [{ c: 0, r: 0, s: "full", k: "thruster" }],
                placement: [{ c: 1, r: 0, s: "full", k: "weapon" }],
            },
        })

        expect(ship.layers.components.size).toBe(2)
        expect(warnings.some((w) => w.includes("unknown layer"))).toBe(false)
    })

    it("warns when the merge lands two cells on one square", () => {
        const { warnings } = readShip({
            version: 6,
            layers: {
                coverable: [{ c: 0, r: 0, s: "full", k: "thruster" }],
                placement: [{ c: 0, r: 0, s: "full", k: "weapon" }],
            },
        })

        expect(warnings.some((w) => w.includes("overwritten"))).toBe(true)
    })
})
describe("accent color", () => {
    it("omits the accent when the art's own is used", () => {
        const ship = new Ship("t", "T")
        ship.layers.components.set(0, 0, "full", { type: "autocannon", color: Color.rgb(1, 1, 1) })

        expect(shipToJson(ship).layers.components![0]!.ac).toBeUndefined()
    })

    it("round-trips an accent that was set", () => {
        const ship = new Ship("t", "T")
        ship.layers.components.set(0, 0, "full", {
            type: "autocannon",
            color: Color.rgb(1, 1, 1),
            accentColor: Color.rgb(1, 0.5, 0),
        })

        const { ship: again, warnings } = shipFromText(shipToText(ship))
        const cell = again.layers.components.get(0, 0)!

        expect(warnings).toEqual([])
        expect(cell.accentColor?.hex).toBe(Color.rgb(1, 0.5, 0).hex)
    })

    it("keeps null distinct from a colour that happens to match", () => {
        // "use the art's accent" is a real value, not a shade of orange - a reader
        // that collapsed the two would freeze every turret at whatever it shipped with
        const ship = new Ship("t", "T")
        ship.layers.components.set(0, 0, "full", { type: "autocannon", color: Color.rgb(1, 1, 1) })

        const { ship: again } = shipFromText(shipToText(ship))
        expect(again.layers.components.get(0, 0)!.accentColor).toBeNull()
    })

    it("warns and falls back when the accent key is missing", () => {
        const { ship, warnings } = readShip({
            version: SHIP_FORMAT_VERSION,
            palette: {},
            layers: { hull: [{ c: 0, r: 0, s: "full", ac: "nosuch" }] },
        })

        expect(ship.layers.hull.get(0, 0)!.accentColor).toBeNull()
        expect(warnings.some((w) => w.includes("nosuch"))).toBe(true)
    })
})
