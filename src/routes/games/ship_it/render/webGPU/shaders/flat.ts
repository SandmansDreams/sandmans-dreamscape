export const FLAT_TRIANGLE = `
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
}

@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
    // Clip space: x and y both run -1..1, y points up.
    let positions = array(
        vec2f( 0.0,  0.5),
        vec2f(-0.5, -0.5),
        vec2f( 0.5, -0.5),
    );
    let colors = array(
        vec4f(1.0, 0.25, 0.35, 1.0),
        vec4f(0.25, 1.0, 0.45, 1.0),
        vec4f(0.35, 0.45, 1.0, 1.0),
    );

    var out: VertexOut;
    out.position = vec4f(positions[index], 0.0, 1.0);
    out.color = colors[index];
    return out;
}

@fragment fn fs(in: VertexOut) -> @location(0) vec4f {
    return in.color;
}
`