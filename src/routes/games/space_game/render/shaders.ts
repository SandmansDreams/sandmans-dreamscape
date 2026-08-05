import { Assert } from "../diagnostics"


/*~~~~ SHADERS ~~~*/
export const MINIMAL_2D_VERTEX_SHADER = `#version 300 es
// Vertex Shader
precision highp float; // High float precision for positions

uniform mat3 u_Transform; // The transform to apply to the vector

layout(location = 0) in vec2 a_Vertex; // The vertex location
layout(location = 1) in vec4 a_Color; // The color location

flat out vec4 v_Color; // Color output

void main() {
    v_Color = a_Color // Set the color
    vec3 position = u_Transform * vec3(a_Vertex, 1.0); // Transform the location of the vertex
    gl_Position = vec4(position.xy, 0.0, 1.0); // Set the output
}
`

export const MINIMAL_2D_FRAGMENT_SHADER = `#version 300 es
// Fragment Shader
precision mediump float; // Medium float precision should be fine

flat in vec4 v_Color; // Create a flat RGBA color input

out vec4 fragColor; // Create an output for the fragment color

void main() {
    fragColor = v_Color; // Apply the color
}
`

/*~~~ CLASSES ~~~*/
export class Program {
    program: WebGLProgram
    shaders: Shader[]
    private readonly uniforms = new Map<string, WebGLUniformLocation>()

    constructor(
        private readonly gl2: WebGL2RenderingContext,
        shaders: Shader[]
    ) {
        this.shaders = shaders
        this.program = this.create(shaders)
    }

    create(shaders: Shader[]) { // Creates a program to run on the GPU
        const program = this.gl2.createProgram()
        Assert.exists({program})

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

    addShader(shader: Shader) {
        this.shaders.push(shader)
        this.gl2.attachShader(this.program, shader)
    }

    use() {
        this.gl2.useProgram(this.program)
    }

    uniform(name: string): WebGLUniformLocation | null {
        let location: WebGLUniformLocation | null | undefined = this.uniforms.get(name)

        if (location === undefined) {
            location = this.gl2.getUniformLocation(this.program, name)
            Assert.exists({location})

            this.uniforms.set(name, location!)
        }

        return location
    }

    dispose() {
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

    constructor (
        private readonly gl2: WebGL2RenderingContext,
        data: number[],
        drawType?: GLenum
    ) {
        this.buffer = drawType ? this.create(data, drawType) : this.create(data)
    }

    create(data?: number[], drawType?: GLenum) { // Creates a new buffer with a new id and data
        const buffer = this.gl2.createBuffer()
        Assert.exists({buffer})

        if (data) {
            this.passData(data, drawType ? drawType : this.gl2.STATIC_DRAW)
        }

        return buffer 
    }

    passData(data: number[], drawType?: GLenum) { // Pass data to the GPU (after setting this to active)
        this.setActive()

        this.gl2.bufferData( // Upload data to the GPU
            this.gl2.ARRAY_BUFFER,
            new Float32Array(data), 
            drawType ? drawType : this.gl2.STATIC_DRAW
        )
    }

    setActive(buffer?: WebGLBuffer) { // Changes the active buffer to this buffer
        this.gl2.bindBuffer(this.gl2.ARRAY_BUFFER, buffer ? buffer : this.buffer)
    }
}