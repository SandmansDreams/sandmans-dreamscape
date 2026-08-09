export const INSTANCED_2D = `
struct Camera {
    // Column-major 2x2 world->clip: (m00, m01, m10, m11)
    transform: vec4f,
    // xy = translation, zw = viewport size in pixels
    offset: vec4f,
}

struct Instance {
    offset: vec2f,   // world position
    rotation: vec2f, // (cos, sin) * scale
    color: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(2) @binding(0) var<storage, read> instances: array<Instance>;

fn worldToClip(world: vec2f) -> vec2f {
    return vec2f(
        camera.transform.x * world.x + camera.transform.z * world.y + camera.offset.x,
        camera.transform.y * world.x + camera.transform.w * world.y + camera.offset.y,
    );
}

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
}

@vertex fn vs(
    @location(0) position: vec2f,
    @location(1) color: vec3f,
    @builtin(instance_index) index: u32,
) -> VertexOut {
    let instance = instances[index];

    // 2x2 rotate-and-scale, then translate into world space
    let world = instance.offset + vec2f(
        position.x * instance.rotation.x - position.y * instance.rotation.y,
        position.x * instance.rotation.y + position.y * instance.rotation.x,
    );

    var out: VertexOut;
    out.position = vec4f(worldToClip(world), 0.0, 1.0);
    out.color = instance.color * vec4f(color, 1.0);
    return out;
}

@fragment fn fs(in: VertexOut) -> @location(0) vec4f {
    return in.color;
}
`