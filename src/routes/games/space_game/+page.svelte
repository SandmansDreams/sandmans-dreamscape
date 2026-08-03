<script lang="ts">
    import { onMount } from "svelte";
    import { Mat4, mat4 } from "ts-gl-matrix";

    let canvas = $state<HTMLCanvasElement | null>(null)
    let gl2 = $state<WebGL2RenderingContext | null>(null)

    let frameId = 0

    const boxVertexData = [
        // Front
        0.5, 0.5, 0.5,
        0.5, -.5, 0.5,
        -.5, 0.5, 0.5,
        -.5, 0.5, 0.5,
        0.5, -.5, 0.5,
        -.5, -.5, 0.5,

        // Left
        -.5, 0.5, 0.5,
        -.5, -.5, 0.5,
        -.5, 0.5, -.5,
        -.5, 0.5, -.5,
        -.5, -.5, 0.5,
        -.5, -.5, -.5,

        // Back
        -.5, 0.5, -.5,
        -.5, -.5, -.5,
        0.5, 0.5, -.5,
        0.5, 0.5, -.5,
        -.5, -.5, -.5,
        0.5, -.5, -.5,

        // Right
        0.5, 0.5, -.5,
        0.5, -.5, -.5,
        0.5, 0.5, 0.5,
        0.5, 0.5, 0.5,
        0.5, -.5, 0.5,
        0.5, -.5, -.5,

        // Top
        0.5, 0.5, 0.5,
        0.5, 0.5, -.5,
        -.5, 0.5, 0.5,
        -.5, 0.5, 0.5,
        0.5, 0.5, -.5,
        -.5, 0.5, -.5,

        // Bottom
        0.5, -.5, 0.5,
        0.5, -.5, -.5,
        -.5, -.5, 0.5,
        -.5, -.5, 0.5,
        0.5, -.5, -.5,
        -.5, -.5, -.5,
    ];

    let colorData: number[] = []

    function createWebGL2Buffer(data: number[]) { // Create an array buffer to hold array information
        if (!gl2) throw new Error('gl2 not defined at initializeWebGL2Buffer()')

        const buffer = gl2.createBuffer()
        gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer)
        gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(data), gl2.DYNAMIC_DRAW)

        return buffer
    }

    function createShader(type: GLenum, GLSL: string) {
        if (!gl2) throw new Error('gl2 not defined at createShader()')

        const shader = gl2.createShader(type)
        if (!shader) throw new Error('vertexShader not defined at createShader()')

        gl2.shaderSource(shader, GLSL)
        gl2.compileShader(shader)

        if (!gl2.getShaderParameter(shader, gl2.COMPILE_STATUS))
            throw new Error(gl2.getShaderInfoLog(shader) ?? 'shader compile failed')

        return shader
    }

    function createWebGL2Program(vertexShader: WebGLShader, fragmentShader: WebGLShader) { // Creates a program to run on the GPU
        if (!gl2) throw new Error('gl2 not defined at createWebGL2Program()')

        const program = gl2.createProgram()
        gl2.attachShader(program, vertexShader)
        gl2.attachShader(program, fragmentShader)
        gl2.linkProgram(program)

        return program
    }

    function createWebGL2Pointer(program: WebGLProgram, name: string, buffer: WebGLBuffer) { // Create a pointer to the array buffer data on the GPU?
        if (!gl2) throw new Error('gl2 not defined at createWebGL2Pointer()')

        const location = gl2.getAttribLocation(program, name)
        gl2.enableVertexAttribArray(location)
        gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer)
        gl2.vertexAttribPointer(location, 3, gl2.FLOAT, false, 0, 0)
    }

    function assignWebGL2Pointers(program: WebGLProgram, positionBuffer: WebGLBuffer, colorBuffer: WebGLBuffer) {
        if (!gl2) throw new Error('gl2 not defined at drawWebGL2()')

        // Create pointers to the vertex position data
        createWebGL2Pointer(program, 'position', positionBuffer)
        createWebGL2Pointer(program, 'color', colorBuffer)
    }

    function resizeWebGL2Context(renderScale = 1): Boolean {
        if (!canvas || !gl2) throw new Error('canvas or gl2 not defined at resizeCanvas()')

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

    function renderFrame(program: WebGLProgram, matrix: Mat4) {
        if (!gl2) throw new Error('gl2 not defined at animate()')

        const uniformLocations = {
            matrix: gl2.getUniformLocation(program, 'matrix')
        }

        //mat4.rotate(matrix, matrix, Math.PI/2 / 70, [0, 0, 1])
        mat4.rotateZ(matrix, matrix, Math.PI/2 / 70)
        mat4.rotateX(matrix, matrix, Math.PI/2 / 70)

        gl2.uniformMatrix4fv(uniformLocations.matrix, false, matrix)
        gl2.drawArrays(gl2.TRIANGLES, 0, boxVertexData.length / 3)
    }

    function randomMatrixColor() {
        return [Math.random(), Math.random(), Math.random()]
    }

    function randomCubeColor() {
        for (let face = 0; face < 6; face++) {
            let faceColor = randomMatrixColor()
            for (let vertex = 0; vertex < 6; vertex++) {
                colorData.push(...faceColor)
            }
        }
    }

    onMount (() => {
        if (!canvas) throw new Error('canvas not defined at onMount()')

        gl2 = canvas.getContext("webgl2")
        if (!gl2) {
            throw new Error('WebGL2 not supported')
        }

        resizeWebGL2Context(.15)
        randomCubeColor()

        const positionBuffer = createWebGL2Buffer(boxVertexData)
        const colorBuffer = createWebGL2Buffer(colorData)
        
        const vertexShader = createShader(gl2.VERTEX_SHADER, 
            `precision mediump float;

            attribute vec3 position;
            attribute vec3 color;
            varying vec3 vColor;

            uniform mat4 matrix;

            void main() {
                vColor = color;
                gl_Position = matrix * vec4(position, 1);
            }
        `)
        
        const fragmentShader = createShader(gl2.FRAGMENT_SHADER, 
            `precision mediump float;

            varying vec3 vColor;

            void main() {
                gl_FragColor = vec4(vColor, 1);
            }
        `)
        
        const program = createWebGL2Program(vertexShader, fragmentShader)

        gl2.useProgram(program)
        gl2.enable(gl2.DEPTH_TEST)

        assignWebGL2Pointers(program, positionBuffer, colorBuffer)

        const matrix = mat4.create()
        mat4.translate(matrix, matrix, [.2, .5, 0])
        mat4.scale(matrix, matrix, [0.25, 0.25, 0.25])

        const loop = (time: number) => {
            renderFrame(program, matrix)
            frameId = requestAnimationFrame(loop)
        }

        frameId = requestAnimationFrame(loop)

        return () => cancelAnimationFrame(frameId)
    })
</script>

<canvas bind:this={canvas}></canvas>

<style>
    canvas {
        background-color: black;
        position: absolute;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        margin-inline: auto;
        padding: 0;
        z-index: 0;
        pointer-events: none;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
    }
</style>