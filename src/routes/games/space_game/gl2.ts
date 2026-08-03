import type { Vec3Like } from "ts-gl-matrix"

export function resizeWebGL2Context(canvas: HTMLCanvasElement, gl2: WebGL2RenderingContext, renderScale = 1): Boolean { // Resizes canvas context to be at different scales, 1 is full size, lower than one becomes more pixelated
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    const width = Math.max(1, Math.round(rect.width * dpr * renderScale))
    const height = Math.max(1, Math.round(rect.height * dpr * renderScale))

    // Don't change unless different
    if (canvas.width === width && canvas.height === height) return false

    canvas.width = width
    canvas.height = height
    gl2.viewport(0, 0, width, height)
    return true
}

export function randomMat3NO(): Vec3Like { // Returns a random 3 float matrix between -1 and 1
    return [
        (Math.random() - 0.5) * 2, 
        (Math.random() - 0.5) * 2, 
        (Math.random() - 0.5) * 2
    ]
}

export function randomMat3ZO(): Vec3Like { // Returns a random 3 float matrix between 0 and 1
    return [
        Math.random(), 
        Math.random(), 
        Math.random()
    ]
}

export function createWebGL2Buffer(gl2: WebGL2RenderingContext, data: number[]) { // Create an array buffer to hold array information
    const buffer = gl2.createBuffer()
    gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer)
    gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(data), gl2.DYNAMIC_DRAW)

    return buffer
}

export function createShader(gl2: WebGL2RenderingContext, type: GLenum, GLSL: string) { // Creates a generalized shader by type
    const shader = gl2.createShader(type)
    if (!shader) throw new Error('vertexShader not defined at createShader()')

    gl2.shaderSource(shader, GLSL)
    gl2.compileShader(shader)

    if (!gl2.getShaderParameter(shader, gl2.COMPILE_STATUS))
        throw new Error(gl2.getShaderInfoLog(shader) ?? 'shader compile failed')

    return shader
}

//TODO: Generalize to take an array of shaders and attach foreach
export function createWebGL2Program(gl2: WebGL2RenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) { // Creates a program to run on the GPU
    const program = gl2.createProgram()
    gl2.attachShader(program, vertexShader)
    gl2.attachShader(program, fragmentShader)
    gl2.linkProgram(program)

    return program
}

export function createWebGL2Pointer(gl2: WebGL2RenderingContext, program: WebGLProgram, name: string, buffer: WebGLBuffer) { // Create a pointer to the array buffer data on the GPU?
    const location = gl2.getAttribLocation(program, name)
    gl2.enableVertexAttribArray(location)
    gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer)
    gl2.vertexAttribPointer(location, 3, gl2.FLOAT, false, 0, 0)
}