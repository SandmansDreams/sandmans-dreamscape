import type { VertexAttribute } from "./mesh"

export const BASIC_VERTEX_SHADER = `#version 300 es

// Vec2 since it's a 2d game
layout(location = 0) in vec2 aPosition;    // per vertex
layout(location = 1) in vec4 aTransform;   // per instance: x, y, cos*scale, sin*scale
layout(location = 2) in vec3 aColor;       // per instance

uniform mat4 uProjection;

flat out vec3 vColor;

void main() {
    vec2 rotated = vec2(
        aPosition.x * aTransform.z - aPosition.y * aTransform.w,
        aPosition.x * aTransform.w + aPosition.y * aTransform.z
    );

    vColor = aColor;
    gl_Position = uProjection * vec4(rotated + aTransform.xy, 0.0, 1.0);
}
`

/**
 * For meshes whose colour varies within a single instance — grid cells, where
 * hull, cockpit and engine are all one mesh.
 *
 * Colour moves to a per-vertex attribute and the per-instance data shrinks to
 * the transform alone, which matters because that is the buffer rewritten every
 * frame for every entity.
 */
export const MESH_VERTEX_SHADER = `#version 300 es

layout(location = 0) in vec2 aPosition;    // per vertex
layout(location = 1) in vec3 aColor;       // per vertex
layout(location = 2) in vec4 aTransform;   // per instance: x, y, cos*scale, sin*scale

uniform mat4 uProjection;

flat out vec3 vColor;

void main() {
    vec2 rotated = vec2(
        aPosition.x * aTransform.z - aPosition.y * aTransform.w,
        aPosition.x * aTransform.w + aPosition.y * aTransform.z
    );

    vColor = aColor;
    gl_Position = uProjection * vec4(rotated + aTransform.xy, 0.0, 1.0);
}
`

/**
 * Per-cell shading, ported from the Canvas2D lighting engine.
 *
 * The old renderer sampled each light once per entity and then coloured each
 * cell as a whole, and that is reproduced exactly here — the geometry changed,
 * the model did not:
 *
 *   - The light is measured to the hull's centre, not to each cell, so
 *     direction and intensity are constant across a ship. Everything that
 *     varies within the hull comes out of the next two terms.
 *   - A cell's "normal" is the direction out from the hull's centre. It treats
 *     the ship as a dome; the old engine did the same, and it is why a hull
 *     reads as rounded rather than as a flat sprite with a line across it.
 *   - The radial term keeps the interior near its base colour and pushes
 *     contrast out to the silhouette.
 *
 * The whole thing runs in the vertex shader and comes out `flat`, because every
 * vertex of a cell reports the same cell centre and so resolves to the same
 * illumination. That is what makes the shading blocky rather than a smooth
 * gradient — one value per cell, the way the CPU version worked.
 */
export const LIT_MESH_VERTEX_SHADER = `#version 300 es

layout(location = 0) in vec2 aPosition;      // per vertex, hull-local
layout(location = 1) in vec3 aColor;         // per vertex
layout(location = 2) in vec2 aCellCentre;    // per vertex, hull-local
layout(location = 3) in vec4 aTransform;     // per instance: x, y, cos*scale, sin*scale

uniform mat4 uProjection;

uniform vec2 uLightPos;       // world space
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uLightRange;    // distance at which illumination has halved

uniform float uShadingRadius; // cells this far out get full contrast

uniform float uContrast;      // how much the lit side brightens
uniform float uShadowDepth;   // how much the shadow side darkens
uniform float uTint;          // how strongly the light colours what it lights
uniform float uAmbientBleed;  // how strongly ambient fills what it does not
uniform vec3 uAmbientColor;

uniform float uMultiply;      // 0 = add the light's colour, 1 = filter by it

flat out vec3 vLit;

void main() {
    vec2 rotated = vec2(
        aPosition.x * aTransform.z - aPosition.y * aTransform.w,
        aPosition.x * aTransform.w + aPosition.y * aTransform.z
    );

    // One sample per hull, at its centre.
    vec2 toLight = uLightPos - aTransform.xy;
    float distSq = dot(toLight, toLight);
    float intensity = min(uLightIntensity / (1.0 + distSq / (uLightRange * uLightRange)), 1.0);

    // Carry the light direction back into hull space, so the per-cell maths needs no trigonometry. Scale cancels in the normalise.
    float len = length(toLight);
    vec2 world = len > 0.0001 ? toLight / len : vec2(0.0, -1.0);
    vec2 lightDir = normalize(vec2(
        world.x * aTransform.z + world.y * aTransform.w,
        world.y * aTransform.z - world.x * aTransform.w
    ));

    float reach = length(aCellCentre);
    float facing = reach > 0.0001
        ? (dot(aCellCentre / reach, lightDir) + 1.0) * 0.5
        : 0.5;

    // Smoothstep across the terminator, then fade the whole effect toward the
    // hull's centre.
    float diffuse = facing * facing * (3.0 - 2.0 * facing);
    float radial = min(reach / uShadingRadius, 1.0);

    float e = 0.5 + (diffuse - 0.5) * radial * intensity;

    // -1 fully shadowed, 0 base colour, +1 fully lit. The 2.5 overdrives that
    // range deliberately, so the extremes are reached before the terminator.
    float k = (e - 0.5) * 2.5;

    float gain = k >= 0.0 ? 1.0 + uContrast * k : 1.0 + uShadowDepth * k;

    if (uMultiply > 0.5) {
        // The light filters the surface rather than adding to it.
        //
        // Adding can only raise the channels the base is *low* in, which is
        // desaturation by definition — an additive purple on a green hull
        // washes it grey instead of colouring it. Filtering takes away the
        // hues the light lacks, so the surface goes darker and keeps its own
        // colour, which is also what actually happens to a green object under
        // a purple lamp.
        //
        // uTint keeps its meaning: 0 leaves the surface alone, 1 applies the
        // light's colour in full. Clamped because k overdrives past 1.
        vec3 filtered = k >= 0.0
            ? mix(vec3(1.0), uLightColor, clamp(uTint * k, 0.0, 1.0))
            : mix(vec3(1.0), uAmbientColor, clamp(uAmbientBleed * -k, 0.0, 1.0));

        vLit = aColor * gain * filtered;
    } else {
        vLit = k >= 0.0
            ? aColor * gain + uLightColor * (k * uTint)
            : aColor * gain + uAmbientColor * (-k * uAmbientBleed);
    }

    gl_Position = uProjection * vec4(rotated + aTransform.xy, 0.0, 1.0);
}
`

/** Nothing left to do — the shading is already resolved per cell. */
export const LIT_FRAGMENT_SHADER = `#version 300 es

precision mediump float;

flat in vec3 vLit;

out vec4 fragColor;

void main() {
    fragColor = vec4(vLit, 1.0);
}
`

export const BASIC_FRAGMENT_SHADER = `#version 300 es

// Medium precision but should be negligible
precision mediump float;

flat in vec3 vColor;

out vec4 fragColor;

// Seam for the lighting engine. Identity for now — M4 replaces this body and nothing else in the shader has to move.
vec3 shade(vec3 base) {
    return base;
}

void main() {
    fragColor = vec4(shade(vColor), 1.0);
}
`

/**
 * The shaders a grid mesh can be drawn with, as data.
 *
 * A shader and the attribute layout it declares have to agree exactly, and
 * nothing at runtime notices when they stop agreeing — a mismatched location
 * silently reads the wrong floats. Keeping them in one entry is the cheapest
 * way to stop that happening, and it gives the settings panel a list to build
 * its picker from, the same way engine/hulls gives it the ship list.
 *
 * Only mesh shaders live here. BASIC_VERTEX_SHADER takes its colour per
 * instance rather than per vertex, so it cannot draw a hull at all — it is for
 * the squares baseline and nothing else.
 */
export interface MeshShaderDef {
    id: string
    label: string
    vertex: string
    fragment: string
    base: VertexAttribute[]
    instance: VertexAttribute[]
    /** Needs the cell centres `buildGridMesh` can append. */
    needsCellCentres: boolean
    /** Reads the light and shading uniforms. */
    lit: boolean
}

export const MESH_SHADERS: readonly MeshShaderDef[] = [
    {
        id: "lit",
        label: "per-cell lit",
        vertex: LIT_MESH_VERTEX_SHADER,
        fragment: LIT_FRAGMENT_SHADER,
        base: [{ location: 0, size: 2 }, { location: 1, size: 3 }, { location: 2, size: 2 }],
        instance: [{ location: 3, size: 4 }],
        needsCellCentres: true,
        lit: true
    },
    {
        id: "flat",
        label: "flat (unlit)",
        vertex: MESH_VERTEX_SHADER,
        fragment: BASIC_FRAGMENT_SHADER,
        base: [{ location: 0, size: 2 }, { location: 1, size: 3 }],
        instance: [{ location: 2, size: 4 }],
        needsCellCentres: false,
        lit: false
    },
]

/** Throws on an unknown id: that is a typo in code, not bad user data. */
export function meshShader(id: string): MeshShaderDef {
    const found = MESH_SHADERS.find(shader => shader.id === id)
    if (!found) throw new Error(`no mesh shader named "${id}"`)

    return found
}
