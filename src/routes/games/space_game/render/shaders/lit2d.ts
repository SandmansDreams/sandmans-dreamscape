/**
 * Per-cell shading, ported from the WebGL version, which ported it from Canvas.
 *
 * The model has not changed across three renderers, so it is worth restating:
 *
 *   - The light is sampled once per hull, on the CPU, and arrives here already
 *     rotated into the hull's own space. Direction and intensity are constant
 *     across a ship; everything that varies within it comes from the next two
 *     terms.
 *   - A cell's "normal" is the direction out from the hull's centre. It treats
 *     the ship as a dome, and it is why a hull reads as rounded rather than as a
 *     flat sprite with a line drawn across it.
 *   - The radial term keeps the interior near its base colour and pushes the
 *     contrast out to the silhouette.
 *
 * It all runs in the vertex shader and comes out `flat`, because every vertex of
 * a cell reports the same cell centre and so resolves to the same illumination.
 * That is what keeps the shading blocky rather than a smooth gradient - one
 * value per cell, the way the CPU version worked.
 */
export const LIT_2D = `
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

// One hull's aggregate light, in that hull's own space
struct Surface {
    direction: vec2f,
    intensity: f32,
    // Cells this far from the centre get full contrast
    reach: f32,
    tint: vec4f,
}

struct Shading {
    // contrast, shadowDepth, tint, ambientBleed
    knobs: vec4f,
    // ambient rgb, and w > 0.5 to filter by the light rather than add to it
    ambient: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> shading: Shading;
@group(1) @binding(1) var<storage, read> surfaces: array<Surface>;
@group(1) @binding(2) var<storage, read> cellGlow: array<vec4f>;
@group(2) @binding(0) var<storage, read> instances: array<Instance>;

fn worldToClip(world: vec2f) -> vec2f {
    return vec2f(
        camera.transform.x * world.x + camera.transform.z * world.y + camera.offset.x,
        camera.transform.y * world.x + camera.transform.w * world.y + camera.offset.y,
    );
}

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(flat) color: vec4f,
}

@vertex fn vs(
    @location(0) position: vec2f,
    @location(1) color: vec3f,
    @location(2) cell: vec4f,           // cell centre xy, emission z, cell index w
    @location(3) spill: vec3f,          // glow from the emissive cells nearby
    @builtin(instance_index) index: u32,
) -> VertexOut {
    let instance = instances[index];
    let surface = surfaces[index];

    let world = instance.offset + vec2f(
        position.x * instance.rotation.x - position.y * instance.rotation.y,
        position.x * instance.rotation.y + position.y * instance.rotation.x,
    );

    let base = color * instance.color.rgb;

    let centre = cell.xy;
    let reach = length(centre);

    // A cell sitting exactly on the hull's centre has no outward direction, so
    // it takes the terminator value and is neither lit nor shadowed
    var facing = 0.5;
    if (reach > 0.0001) {
        facing = (dot(centre / reach, surface.direction) + 1.0) * 0.5;
    }

    // Smoothstep across the terminator, then fade the whole effect toward the
    // hull's centre so the interior keeps its own colour
    let diffuse = facing * facing * (3.0 - 2.0 * facing);
    let radial = min(reach / max(surface.reach, 0.0001), 1.0);
    let e = 0.5 + (diffuse - 0.5) * radial * surface.intensity;

    // -1 fully shadowed, 0 base colour, +1 fully lit. The 2.5 overdrives that
    // range deliberately, so the extremes are reached before the terminator.
    let k = (e - 0.5) * 2.5;

    let contrast = shading.knobs.x;
    let shadowDepth = shading.knobs.y;
    let tintStrength = shading.knobs.z;
    let ambientBleed = shading.knobs.w;

    var gain = 1.0 + shadowDepth * k;
    if (k >= 0.0) {
        gain = 1.0 + contrast * k;
    }

    var shaded = base;
    if (shading.ambient.w > 0.5) {
        // The light filters the surface rather than adding to it.
        //
        // Adding can only raise the channels the base is *low* in, which is
        // desaturation by definition - an additive purple on a green hull washes
        // it grey instead of colouring it. Filtering takes away the hues the
        // light lacks, so the surface goes darker and keeps its own colour,
        // which is also what happens to a green object under a purple lamp.
        var filtered = mix(vec3f(1.0), shading.ambient.rgb, clamp(ambientBleed * -k, 0.0, 1.0));
        if (k >= 0.0) {
            filtered = mix(vec3f(1.0), surface.tint.rgb, clamp(tintStrength * k, 0.0, 1.0));
        }
        shaded = base * gain * filtered;
    } else {
        shaded = base * gain + shading.ambient.rgb * (-k * ambientBleed);
        if (k >= 0.0) {
            shaded = base * gain + surface.tint.rgb * (k * tintStrength);
        }
    }

    // An emissive cell makes its own light, so shading it would be backwards.
    // It keeps its base colour and brightens past it instead.
    //
    // Scaled by the hull's emission gain, and scaled *before* the mix on purpose:
    // at gain 0 the cell falls all the way back to the shaded value and takes light
    // like any other plate. Dimming only the brightness would leave an unlit
    // patch sitting flat against a shaded hull, which reads as a bug rather than
    // as a window that has gone out.
    let emission = clamp(cell.z, 0.0, 1.0) * surface.tint.w;
    var lit = mix(shaded, base * (1.0 + emission), emission);

    // Baked at build time, because an emissive cell is welded to the hull: what
    // it throws on its neighbours can only change when the ship does. Added
    // rather than run through the terminator, since a soft glow off a strip has
    // no direction to shade from - and scaled by the same gain, so a ship losing
    // power stops lighting itself at the moment its windows go out.
    lit = lit + spill * surface.tint.w;

    // Per cell and per frame, for light that moves: an engine burning brightens
    // the plates around its own nozzle. Baking this the way the emissive spill is
    // baked would mean rewriting the whole cell channel every frame - the same
    // answer at seventy times the bytes, since a cell has many vertices.
    lit = lit + cellGlow[u32(cell.w)].rgb;

    var out: VertexOut;
    out.position = vec4f(worldToClip(world), 0.0, 1.0);
    out.color = vec4f(lit, instance.color.a);
    return out;
}

@fragment fn fs(in: VertexOut) -> @location(0) vec4f {
    return in.color;
}
`
