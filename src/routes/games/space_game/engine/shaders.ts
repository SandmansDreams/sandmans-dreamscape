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