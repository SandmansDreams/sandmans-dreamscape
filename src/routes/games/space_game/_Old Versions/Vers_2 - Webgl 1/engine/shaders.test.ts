import { describe, expect, it } from "vitest"

import { LIT_MESH_STRIDE, MESH_STRIDE } from "./gridMesh"
import { MESH_SHADERS, meshShader } from "./shaders"

/**
 * Specification for the mesh shader registry.
 *
 * A shader's `layout(location = N)` declarations and the VertexAttribute list
 * handed to the batch have to agree exactly, and nothing at runtime notices
 * when they stop: a wrong location or size reads the neighbouring floats and
 * draws something plausible but wrong. These check the pairing that the
 * registry exists to hold together.
 */

/** Pulls `layout(location = N) in <type> aName` out of GLSL source. */
function declaredAttributes(source: string) {
    const pattern = /layout\(location\s*=\s*(\d+)\)\s*in\s+(\w+)\s+(\w+)/g
    const sizes: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 }

    return [...source.matchAll(pattern)].map(match => ({
        location: Number(match[1]),
        size: sizes[match[2]],
        name: match[3]
    }))
}

describe("MESH_SHADERS", () => {
    it("has entries", () => {
        expect(MESH_SHADERS.length).toBeGreaterThanOrEqual(2)
        expect(MESH_SHADERS.map(s => s.id)).toContain("lit")
    })

    it("gives every shader a distinct id and a label", () => {
        const ids = MESH_SHADERS.map(shader => shader.id)

        expect(new Set(ids).size).toBe(ids.length)
        for (const shader of MESH_SHADERS) {
            expect(shader.label.length, shader.id).toBeGreaterThan(0)
        }
    })

    it.each(MESH_SHADERS.map(s => [s.id, s] as const))("%s declares GLSL ES 3.00", (_, shader) => {
        expect(shader.vertex.startsWith("#version 300 es")).toBe(true)
        expect(shader.fragment.startsWith("#version 300 es")).toBe(true)

        // A fragment shader without a precision qualifier fails to compile.
        expect(shader.fragment).toContain("precision")
    })

    // The reason the registry exists.
    it.each(MESH_SHADERS.map(s => [s.id, s] as const))(
        "%s's layout matches what its source declares",
        (_, shader) => {
            const declared = declaredAttributes(shader.vertex)
            const configured = [...shader.base, ...shader.instance]

            expect(declared).toHaveLength(configured.length)

            for (const attribute of configured) {
                const match = declared.find(d => d.location === attribute.location)
                expect(match, `location ${attribute.location}`).toBeDefined()
                expect(match!.size, match!.name).toBe(attribute.size)
            }
        }
    )

    it.each(MESH_SHADERS.map(s => [s.id, s] as const))(
        "%s's vertex stride matches the mesh it asks for",
        (_, shader) => {
            const stride = shader.base.reduce((total, a) => total + a.size, 0)
            expect(stride).toBe(shader.needsCellCentres ? LIT_MESH_STRIDE : MESH_STRIDE)
        }
    )

    it("puts per-instance attributes after per-vertex ones", () => {
        for (const shader of MESH_SHADERS) {
            const lastBase = Math.max(...shader.base.map(a => a.location))
            const firstInstance = Math.min(...shader.instance.map(a => a.location))

            expect(firstInstance, shader.id).toBeGreaterThan(lastBase)
        }
    })

    it("only calls a shader lit when it reads the light uniforms", () => {
        for (const shader of MESH_SHADERS) {
            expect(shader.vertex.includes("uLightPos"), shader.id).toBe(shader.lit)
        }
    })
})

describe("meshShader", () => {
    it("finds a shader by id", () => {
        expect(meshShader("lit").id).toBe("lit")
    })

    it("throws on an unknown id rather than returning something plausible", () => {
        expect(() => meshShader("phong")).toThrow(/phong/)
    })
})
