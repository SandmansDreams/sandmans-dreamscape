import { describe, expect, it } from "vitest"
import { Ship } from "./ship"
import { readShip, shipFromText, shipToJson, shipToText, SHIP_FORMAT_VERSION } from "./shipJson"

function sample(): Ship {
    const ship = new Ship("test", "Test Ship")

    ship.layers.hull.set(0, 0, "full", { color: [0.58, 0.63, 0.7] })
    ship.layers.hull.set(1, 0, "wedge", { turns: 2, color: [0.58, 0.63, 0.7] })
    ship.layers.hull.set(-1, 0, "halfWedge", { mirrored: true, color: [0.26, 0.29, 0.34] })
    ship.layers.coverable.set(0, 1, "full", {
        kind: "thruster",
        facing: 2,
        emission: 0.8,
        color: [0.26, 0.29, 0.34],
    })
    ship.layers.cosmetic.set(0, -1, "centerLine", { color: [0.35, 0.85, 1] })

    return ship
}

describe("shipToJson()", () => {
    it("omits every default", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full", { color: [1, 1, 1] })

        const cell = shipToJson(ship).layers.hull![0]!
        // c, r, s and the palette key - nothing else
        expect(Object.keys(cell).sort()).toEqual(["c", "p", "r", "s"])
    })

    it("writes only the fields that differ from the defaults", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(2, 3, "wedge", { turns: 1, mirrored: true, hitPoints: 99, color: [1, 1, 1] })

        const cell = shipToJson(ship).layers.hull![0]!
        expect(cell).toMatchObject({ c: 2, r: 3, s: "wedge", t: 1, m: true, hp: 99 })
        expect(cell.lv).toBeUndefined()
        expect(cell.f).toBeUndefined()
    })

    it("names palette entries by their hex digits", () => {
        const ship = new Ship("t", "T")
        ship.layers.hull.set(0, 0, "full", { color: [0.58, 0.63, 0.7] })

        expect(Object.keys(shipToJson(ship).palette)).toEqual(["94a1b3"])
    })

    it("keeps two near-identical colors apart", () => {
        const ship = new Ship("t", "T")
        // Both round to the same hex, so a naive writer would merge them
        ship.layers.hull.set(0, 0, "full", { color: [0.58, 0.63, 0.7] })
        ship.layers.hull.set(1, 0, "full", { color: [0.5801, 0.63, 0.7] })

        expect(Object.keys(shipToJson(ship).palette)).toHaveLength(2)
    })

    it("does not write cosmetic mass, which is forced to zero on the way back", () => {
        const ship = new Ship("t", "T")
        ship.layers.cosmetic.set(0, 0, "full", { color: [1, 1, 1] })

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

        const thruster = ship.layers.coverable.get(0, 1)!
        expect(thruster.kind).toBe("thruster")
        expect(thruster.facing).toBe(2)
        expect(thruster.emission).toBe(0.8)

        expect(ship.layers.hull.get(-1, 0)!.mirrored).toBe(true)
        expect(ship.layers.hull.get(1, 0)!.turns).toBe(2)
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

    it("falls back to hull for an unknown kind rather than dropping the block", () => {
        const { ship, warnings } = readShip({
            version: SHIP_FORMAT_VERSION,
            layers: { hull: [{ c: 0, r: 0, s: "full", k: "warp-core" }] },
        })

        expect(ship.layers.hull.get(0, 0)!.kind).toBe("hull")
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