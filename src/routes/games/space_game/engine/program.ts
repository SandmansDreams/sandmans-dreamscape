import type { Mat4 } from "ts-gl-matrix"

export class Program {
    readonly program: WebGLProgram
    private readonly locations = new Map<string, WebGLUniformLocation | null>

    constructor(
        private readonly gl2: WebGL2RenderingContext,
        vertexSource: string,
        fragmentSource: string
    ) {
        const vertex = this.createShader(gl2.VERTEX_SHADER, vertexSource)
        const fragment = this.createShader(gl2.FRAGMENT_SHADER, fragmentSource)

        const program = this.createProgram([vertex, fragment])
        this.program = program
        
        this.dismissShader(vertex)
        this.dismissShader(fragment)
    }

    createShader(type: GLenum, GLSL: string): WebGLShader { // Creates a generalized shader by type
        const shader = this.gl2.createShader(type) // Create a shader of the given type
        if (!shader) throw new Error("'shader' not defined at Program.createShader()")

        this.gl2.shaderSource(shader, GLSL) // Pass in the GLSL shader language code
        this.gl2.compileShader(shader) // Compile the shader so that it functions

        // If the shader fails to compile, delete it and throw an error
        if (!this.gl2.getShaderParameter(shader, this.gl2.COMPILE_STATUS)) {
            const log = this.gl2.getShaderInfoLog(shader)
            this.gl2.deleteShader(shader)
            throw new Error(log ?? "shader compile failed at Program.createShader()")
        }

        return shader
    }

    dismissShader(shader: WebGLShader) { // Cleanup of shader
        this.gl2.detachShader(this.program, shader)
        this.gl2.deleteShader(shader)
    }

    createBuffer(data: number[], drawType = this.gl2.STATIC_DRAW): WebGLBuffer { // Create an array buffer to hold array information
        const buffer = this.gl2.createBuffer()
        this.gl2.bindBuffer(this.gl2.ARRAY_BUFFER, buffer)
        this.gl2.bufferData(this.gl2.ARRAY_BUFFER, new Float32Array(data), drawType)

        return buffer
    }

    createProgram(shaders: WebGLShader[]) { // Creates a program to run on the GPU
        const program = this.gl2.createProgram()
        if (!program) throw new Error("gl.createProgram() returned null at Program.createProgram()") // Shouldn't be possible but just in case

        // Attach each shader to the program
        for (const shader of shaders) {
            this.gl2.attachShader(program, shader)
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

    /* createPointer(program: WebGLProgram, name: string, buffer: WebGLBuffer) { // Create a pointer to the array buffer data on the GPU?
        const location = this.gl2.getAttribLocation(program, name)

        this.gl2.enableVertexAttribArray(location)
        this.gl2.bindBuffer(this.gl2.ARRAY_BUFFER, buffer)
        this.gl2.vertexAttribPointer(location, 3, this.gl2.FLOAT, false, 0, 0)
    } */

    use(): void {
        this.gl2.useProgram(this.program)
    }

    uniform(name: string): WebGLUniformLocation | null {
        let location = this.locations.get(name)

        if (location === undefined) {
            location = this.gl2.getUniformLocation(this.program, name)

            if (location === null) {
                console.warn(`Uniform location ${name} not found in WebGL2Program.uniform()`)
            }

            this.locations.set(name, location)
        }

        return location
    }

    setMatrix4(name: string, value: Mat4) {
        this.gl2.uniformMatrix4fv(this.uniform(name), false, value)
    }

    setFloat(name: string, value: number) {
        this.gl2.uniform1f(this.uniform(name), value)
    }

    setVec2(name: string, x: number, y: number) {
        this.gl2.uniform2f(this.uniform(name), x, y)
    }

    setVec3(name: string, x: number, y: number, z: number) {
        this.gl2.uniform3f(this.uniform(name), x, y, z)
    }

    dispose() {
        this.gl2.deleteProgram(this.program)
        this.locations.clear()
    }
}