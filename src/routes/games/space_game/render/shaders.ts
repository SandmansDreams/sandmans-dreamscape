import { Assert } from "../assert"

/*~~~ CLASSES ~~~*/
export class Program {
    program: WebGLProgram
    shaders: Shader[]
    private readonly uniforms = new Map<string, WebGLUniformLocation | null>()

    constructor(
        private readonly gl2: WebGL2RenderingContext,
        shaders: Shader[]
    ) {
        this.shaders = shaders
        this.program = this.create(shaders)
        this.use()
    }

    create(shaders: Shader[]) { // Creates a program to run on the GPU
        const program = this.gl2.createProgram()
        Assert.exists(program, "program")

        // Attach each shader to the program
        for (const Shader of shaders) {
            this.gl2.attachShader(program, Shader.shader)
        }

        // Link the program to the context
        this.gl2.linkProgram(program)
        if (!this.gl2.getProgramParameter(program, this.gl2.LINK_STATUS)) {
            const log = this.gl2.getProgramInfoLog(program)
            this.gl2.deleteProgram(program)
            throw new Error(log ?? "'program' failed to link in Program.createProgram()")
        }

        return program
    }

    use() {
        this.gl2.useProgram(this.program)
    }

    uniform(name: string): WebGLUniformLocation | null {
        if (!this.uniforms.has(name)) { // has(), so a null result is cached too
            this.uniforms.set(name, this.gl2.getUniformLocation(this.program, name))
        }
        return this.uniforms.get(name) ?? null
    }

    dispose() {
        this.shaders.forEach((shader) => shader.dispose(this.program))
        this.gl2.deleteProgram(this.program)
        this.uniforms.clear()
    }
}

export class Shader { // A single shader and its GLSL code
    type: GLenum
    GLSL: string
    shader: WebGLShader

    constructor (
        private readonly gl2: WebGL2RenderingContext,
        type: GLenum,
        GLSL: string
    ) {
        this.type = type
        this.GLSL = GLSL

        this.shader = this.create()
    }

    create(): WebGLShader { // Creates a new shader
        const shader = this.gl2.createShader(this.type) // Create a shader of the given type
        if (!shader) throw new Error("'shader' not defined at Program.createShader()")

        this.gl2.shaderSource(shader, this.GLSL) // Pass in the GLSL shader language code
        this.gl2.compileShader(shader) // Compile the shader so that it functions

        // If the shader fails to compile, delete it and throw an error
        if (!this.gl2.getShaderParameter(shader, this.gl2.COMPILE_STATUS)) {
            const log = this.gl2.getShaderInfoLog(shader)
            this.gl2.deleteShader(shader)
            throw new Error(log ?? "shader compile failed at Program.createShader()")
        }

        return shader
    }

    dispose(program: WebGLProgram) {
        this.gl2.detachShader(program, this.shader)
        this.gl2.deleteShader(this.shader)
    }
}

export class Buffer { // An individual buffer for storing data on the GPU
    buffer: WebGLBuffer
    data: number[] | Float32Array
    drawType: GLenum

    constructor (
        private readonly gl2: WebGL2RenderingContext,
        data: number[] | Float32Array,
        drawType?: GLenum,
    ) {
        this.data = data
        this.drawType = drawType ? drawType : this.gl2.STATIC_DRAW

        const buffer = this.gl2.createBuffer()
        Assert.exists(buffer, "buffer")
        this.buffer = buffer

        this.passData(data)
    }

    // Pass data to the GPU (after setting this to active). A Float32Array is
    // uploaded as-is; anything else has to be copied into one first, so pass
    // a Float32Array on any path that runs every frame.
    passData(data: number[] | Float32Array) {
        this.setActive()
        this.data = data

        this.gl2.bufferData( // Upload data to the GPU
            this.gl2.ARRAY_BUFFER,
            data instanceof Float32Array ? data : new Float32Array(data),
            this.drawType
        )
    }

    setActive() { // Changes the active buffer to this buffer
        this.gl2.bindBuffer(this.gl2.ARRAY_BUFFER, this.buffer)
    }

    dispose() { this.gl2.deleteBuffer(this.buffer) }
}

/*~~~~ SHADER SOURCES ~~~*/
export const MINIMAL_2D_VERTEX_SOURCE = `#version 300 es
    // Vertex Shader - per-vertex colour, one transform for the whole draw.
    // Attribute locations must match ATTR_VERTEX / ATTR_COLOR in mesh.ts.
    precision highp float; // High float precision for positions

    uniform mat3 u_Transform; // The transform to apply to the vector

    layout(location = 0) in vec2 a_Vertex; // The vertex location
    layout(location = 1) in vec3 a_Color; // The color location

    flat out vec4 v_Color; // Color output

    void main() {
        v_Color = vec4(a_Color, 1.0); // Set the color
        vec3 position = u_Transform * vec3(a_Vertex, 1.0); // Transform the location of the vertex
        gl_Position = vec4(position.xy, 0.0, 1.0); // Set the output
    }
`

export const INSTANCED_2D_VERTEX_SOURCE = `#version 300 es
    // Vertex Shader - instanced sprites.
    // Attribute locations must match the INST_* constants in batch.ts.
    precision highp float;

    uniform mat3 u_Transform; // world -> clip, set once per frame

    layout(location = 0) in vec2 a_Vertex;   // per vertex: the base geometry
    layout(location = 1) in vec2 a_Offset;   // per instance: world position
    layout(location = 2) in vec2 a_Rotation; // per instance: (cos, sin) * scale
    layout(location = 3) in vec3 a_Color;    // per instance

    flat out vec4 v_Color;

    void main() {
        v_Color = vec4(a_Color, 1.0);

        // [c -s; s c] with the scale already folded into c and s
        vec2 world = a_Offset + vec2(
            a_Vertex.x * a_Rotation.x - a_Vertex.y * a_Rotation.y,
            a_Vertex.x * a_Rotation.y + a_Vertex.y * a_Rotation.x
        );

        vec3 position = u_Transform * vec3(world, 1.0);
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`

export const MINIMAL_2D_FRAGMENT_SOURCE = `#version 300 es
    // Fragment Shader
    precision mediump float; // Medium float precision should be fine

    flat in vec4 v_Color; // Create a flat RGBA color input

    out vec4 fragColor; // Create an output for the fragment color

    void main() {
        fragColor = v_Color; // Apply the color
    }
`

export const PASSTHROUGH_FRAGMENT_SOURCE = `#version 300 es
    // Fragment Shader - copies the scene to the canvas unchanged
    precision mediump float;

    uniform sampler2D u_Scene;

    in vec2 v_UV;

    out vec4 fragColor;

    void main() {
        fragColor = texture(u_Scene, v_UV);
    }
`

export const FULLSCREEN_VERTEX_SOURCE = `#version 300 es
    // Vertex Shader - screen-covering triangle, no attributes needed
    precision highp float;

    out vec2 v_UV;

    void main() {
        // IDs 0,1,2 -> UV (0,0),(2,0),(0,2) -> clip (-1,-1),(3,-1),(-1,3)
        v_UV = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(v_UV * 2.0 - 1.0, 0.0, 1.0);
    }
`

export const CHROMATIC_ABERRATION_2D_FRAGMENT_SOURCE = `#version 300 es
    // Fragment Shader
    precision highp float; 

    uniform sampler2D u_Scene;  // The rendered scene
    uniform vec2 u_Resolution;  // Size of the framebuffer being drawn INTO, in pixels
    uniform float u_Time;       // Seconds since start, drives the rotation
    uniform float u_Intensity;  // 0.0 = off. Subtle at 0.01-0.03, wild past 0.1
    uniform float u_Falloff;    // 0 = even across the screen, 1 = linear, higher = edges only

    in vec2 v_UV;

    out vec4 fragColor;

    void main() {
        // Nothing to do when the effect is off. Uniform branches are coherent
        // across the whole draw, so this costs essentially nothing.
        if (u_Intensity <= 0.0) {
            fragColor = texture(u_Scene, v_UV);
            return;
        }

        // Split the three channels 120 degrees apart, rotating over time
        float angle = u_Time;
        vec2 redOffset = vec2(cos(angle), sin(angle));
        angle += radians(120.0);
        vec2 greenOffset = vec2(cos(angle), sin(angle));
        angle += radians(120.0);
        vec2 blueOffset = vec2(cos(angle), sin(angle));

        // Distance from the center, normalized so 1.0 is the corner
        float halfDiagonal = 0.5 * length(u_Resolution);
        float centerDist = length(gl_FragCoord.xy - 0.5 * u_Resolution) / halfDiagonal;

        // pow(0.0, 0.0) is undefined, so keep the base off zero
        float falloff = pow(max(centerDist, 0.0001), u_Falloff);
        float offsetSize = u_Intensity * halfDiagonal * falloff;

        // Sample each channel from a slightly different place (pixels -> UV)
        float red   = texture(u_Scene, v_UV - offsetSize * redOffset   / u_Resolution).r;
        float green = texture(u_Scene, v_UV - offsetSize * greenOffset / u_Resolution).g;
        float blue  = texture(u_Scene, v_UV - offsetSize * blueOffset  / u_Resolution).b;

        fragColor = vec4(red, green, blue, 1.0);
    }
`

export const CRT_SCANLINES_FRAGMENT_SOURCE = `#version 300 es
    // Fragment Shader - CRT scanlines, aperture grille and vignette
    precision highp float;

    uniform sampler2D u_Scene;
    uniform vec2 u_Resolution;      // Size of the framebuffer being drawn INTO, in pixels
    uniform float u_Time;           // Seconds since start, drifts the bands
    uniform float u_Intensity;      // 0.0 = off, 1.0 = heavy
    uniform float u_ScanlineCount;  // Dark bands down the screen

    in vec2 v_UV;

    out vec4 fragColor;

    void main() {
        vec3 color = texture(u_Scene, v_UV).rgb;

        // Nothing to do when the effect is off
        if (u_Intensity <= 0.0) {
            fragColor = vec4(color, 1.0);
            return;
        }

        // Horizontal bands, drifting slowly downward
        float band = 0.5 + 0.5 * cos((v_UV.y * u_ScanlineCount - u_Time * 0.1) * 6.2831853);
        color *= 1.0 - u_Intensity * 0.7 * band;

        // Aperture grille: tint every third output column toward R, G or B
        float column = mod(gl_FragCoord.x, 3.0);
        vec3 grille = column < 1.0 ? vec3(1.0, 0.6, 0.6)
                    : column < 2.0 ? vec3(0.6, 1.0, 0.6)
                                   : vec3(0.6, 0.6, 1.0);
        color *= mix(vec3(1.0), grille, u_Intensity);

        // Gentle darkening toward the corners
        vec2 fromCenter = v_UV - 0.5;
        color *= 1.0 - u_Intensity * 0.8 * dot(fromCenter, fromCenter);

        // Put back some of the brightness the mask took away
        color *= 1.0 + u_Intensity * 0.4;

        fragColor = vec4(color, 1.0);
    }
`