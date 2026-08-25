import { describe, expect, it } from "vitest"
import { DRY, shipPhysics } from "./physics"
import { Ship } from "./ship"
import {
    deflectOff, shieldArcsOf, shieldCovers, shieldNode, SHIELD_JITTER, SHIELD_SPREAD,
    type ActiveShield,
} from "./shields"

/** A shield at the origin facing along +x, so angles read straight off. */
const EAST: ActiveShield = { at: { x: 0, y: 0 }, facing: 0, radius: 5 }

function shipWith(parts: { type: string; col: number; row: number; facing?: number }[]): Ship {
    const ship = new Ship("t", "T")
    ship.layers.hull.set(0, 0, "full")

    for (const part of parts) {
        ship.layers.components.set(part.col, part.row, "full", {
            type: part.type,
            facing: part.facing ?? 0,
        })
    }

    return ship
}

describe("finding projectors", () => {
    it("takes shield projectors and leaves radar alone", () => {
        // A radar is a projector too, and it projects nothing that stops anything
        const ship = shipWith([
            { type: "shield-projector", col: 0, row: 0 },
            { type: "radar-dish", col: 1, row: 0 },
        ])

        expect(shieldArcsOf(ship, shipPhysics(ship, DRY))).toHaveLength(1)
    })

    it("faces the arc the way the block was placed", () => {
        const ship = shipWith([
            { type: "shield-projector", col: 0, row: 0, facing: 0 },
            { type: "shield-projector", col: 2, row: 0, facing: 2 },
        ])
        const [north, south] = shieldArcsOf(ship, shipPhysics(ship, DRY))

        expect(Math.abs(north!.facing - south!.facing)).toBeCloseTo(Math.PI)
    })

    it("reads its reach and its cost from the registry", () => {
        const ship = shipWith([{ type: "shield-projector", col: 0, row: 0 }])
        const [arc] = shieldArcsOf(ship, shipPhysics(ship, DRY))

        expect(arc!.radius).toBe(3)
        expect(arc!.draw).toBe(4)
    })
})

describe("what a shield covers", () => {
    it("covers what is in front of it", () => {
        expect(shieldCovers(EAST, { x: 3, y: 0 })).toBe(true)
    })

    it("does not cover what is behind it", () => {
        expect(shieldCovers(EAST, { x: -3, y: 0 })).toBe(false)
    })

    it("stops at the edge of the spread", () => {
        // Ninety degrees wide is forty-five either side
        const justInside = SHIELD_SPREAD / 2 - 0.02
        const justOutside = SHIELD_SPREAD / 2 + 0.02

        expect(shieldCovers(EAST, { x: Math.cos(justInside) * 3, y: Math.sin(justInside) * 3 })).toBe(true)
        expect(shieldCovers(EAST, { x: Math.cos(justOutside) * 3, y: Math.sin(justOutside) * 3 })).toBe(false)
    })

    it("does not reach past its radius", () => {
        expect(shieldCovers(EAST, { x: 6, y: 0 })).toBe(false)
    })

    it("counts something wide by its edge, not its middle", () => {
        // Centre is out of reach, but a two-cell rock is touching the face
        expect(shieldCovers(EAST, { x: 6, y: 0 }, 2)).toBe(true)
    })
})

describe("bouncing off a shield", () => {
    it("turns something heading into it", () => {
        const hit = deflectOff(EAST, { x: 3, y: 0 }, { x: -4, y: 0 })

        expect(hit).not.toBeNull()
        expect(hit!.velocity.x).toBeGreaterThan(0)
    })

    it("puts it back on the face rather than leaving it inside", () => {
        const hit = deflectOff(EAST, { x: 3, y: 0 }, { x: -4, y: 0 }, 1)

        expect(Math.hypot(hit!.position.x, hit!.position.y)).toBeCloseTo(6)
    })

    it("lets something already leaving carry on", () => {
        // Shoving it back in would trap it against the face forever
        expect(deflectOff(EAST, { x: 3, y: 0 }, { x: 4, y: 0 })).toBeNull()
    })

    it("ignores what the arc does not cover", () => {
        expect(deflectOff(EAST, { x: -3, y: 0 }, { x: 4, y: 0 })).toBeNull()
    })

    it("keeps the sideways part of a glancing hit", () => {
        // A graze should slide along the face, not stop dead against it
        const hit = deflectOff(EAST, { x: 3, y: 0 }, { x: -4, y: 3 })

        expect(hit!.velocity.y).toBeCloseTo(3)
    })

    it("absorbs the bounce when it is told to", () => {
        const soft = deflectOff(EAST, { x: 3, y: 0 }, { x: -4, y: 0 }, 0, 0)
        expect(soft!.velocity.x).toBeCloseTo(0)
    })
})

describe("the nodes a shield is drawn from", () => {
    const away = (at: { x: number; y: number }) => Math.hypot(at.x - EAST.at.x, at.y - EAST.at.y)

    it("keeps every node on the face, give or take its drift", () => {
        for (let i = 0; i < 12; i++) {
            const at = shieldNode(EAST, i, 12, 3.2)

            expect(away(at)).toBeGreaterThan(EAST.radius - SHIELD_JITTER - 1e-6)
            expect(away(at)).toBeLessThan(EAST.radius + SHIELD_JITTER + 1e-6)
        }
    })

    it("reaches both ends of the arc", () => {
        const first = shieldNode(EAST, 0, 9, 0)
        const last = shieldNode(EAST, 8, 9, 0)

        // Forty-five degrees either side of straight ahead
        expect(Math.atan2(first.y, first.x)).toBeCloseTo(-SHIELD_SPREAD / 2, 5)
        expect(Math.atan2(last.y, last.x)).toBeCloseTo(SHIELD_SPREAD / 2, 5)
    })

    it("gives the same answer for the same instant", () => {
        // A sine of the clock rather than a random number, so it is the same on
        // every machine and can be tested at all
        expect(shieldNode(EAST, 3, 9, 1.5)).toEqual(shieldNode(EAST, 3, 9, 1.5))
    })

    it("moves as time passes", () => {
        expect(shieldNode(EAST, 3, 9, 0).x).not.toBeCloseTo(shieldNode(EAST, 3, 9, 0.2).x, 6)
    })

    it("does not pulse in step with its neighbour", () => {
        // Bands travelling along the arc would read as a pattern, not a field
        expect(away(shieldNode(EAST, 3, 9, 0))).not.toBeCloseTo(away(shieldNode(EAST, 4, 9, 0)), 3)
    })

    it("puts a lone node in the middle rather than dividing by zero", () => {
        const only = shieldNode(EAST, 0, 1, 0)
        expect(Math.atan2(only.y, only.x)).toBeCloseTo(0, 5)
    })
})
