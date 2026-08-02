<script lang="ts">
    import { onMount } from "svelte";

    let canvas = $state<HTMLCanvasElement | null>(null)
    let gl2 = $state<WebGL2RenderingContext | null>(null)

    const vertexData = [
        0, 1, 0,   // V1.position
        1, -1, 0,  // V2.position
        -1, -1, 0  // V3.position
    ]

    const colorData = [
        1, 0, 0,   // V1.color (red)
        0, 1, 0,   // V2.position (green)
        0, 0, 1,   // V3.position (blue)
    ]

    function createWebGL2Buffer(data: number[]) { // Create an array buffer to hold array information
        if (!gl2) throw new Error('gl2 not defined at initializeWebGL2Buffer()')

        const buffer = gl2.createBuffer()
        gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer)
        gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(data), gl2.DYNAMIC_DRAW)

        return buffer
    }

    function createVertexShader() { // Create a basic vertex shader
        if (!gl2) throw new Error('gl2 not defined at createVertexShader()')

        const vertexShader = gl2.createShader(gl2.VERTEX_SHADER)
        if (!vertexShader) throw new Error('vertexShader not defined at createVertexShader()')
        gl2.shaderSource(vertexShader, `
            precision mediump float;

            attribute vec3 position;
            attribute vec3 color;
            varying vec3 vColor;

            void main() {
                vColor = color;
                gl_Position = vec4(position, 1);
            }
        `)
        gl2.compileShader(vertexShader)

        return vertexShader
    }

    function createFragmentShader() { // Create a basic fragment shader
        if (!gl2) throw new Error('gl2 not defined at createFragmentShader()')

        const fragmentShader = gl2.createShader(gl2.FRAGMENT_SHADER)
        if (!fragmentShader) throw new Error('fragmentShader not defined at createFragmentShader()')
        gl2.shaderSource(fragmentShader, `
            precision mediump float;

            varying vec3 vColor;

            void main() {
                gl_FragColor = vec4(vColor, 1);
            }
        `)
        gl2.compileShader(fragmentShader)

        return fragmentShader
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
        gl2.vertexAttribPointer(location, 3, gl2.FLOAT, true, 0, 0)
    }

    function drawWebGL2(program: WebGLProgram, positionBuffer: WebGLBuffer, colorBuffer: WebGLBuffer) {
        if (!gl2) throw new Error('gl2 not defined at drawWebGL2()')

        // Create pointers to the vertex position data
        const positionLocation = createWebGL2Pointer(program, 'position', positionBuffer)
        const colorLocation = createWebGL2Pointer(program, 'color', colorBuffer)

        gl2.useProgram(program)
        gl2.drawArrays(gl2.TRIANGLES, 0, 3)
    }

    onMount (() => {
        if (!canvas) throw new Error('canvas not defined at onMount()')

        gl2 = canvas.getContext("webgl2")
        if (!gl2) {
            throw new Error('WebGL2 not supported')
        }

        const positionBuffer = createWebGL2Buffer(vertexData)
        const colorBuffer = createWebGL2Buffer(colorData)
        
        const vertexShader = createVertexShader()
        const fragmentShader = createFragmentShader()
        
        if (!vertexShader || !fragmentShader) throw new Error('Fragment or vertex shader are undefined')
        
        const program = createWebGL2Program(vertexShader, fragmentShader)

        drawWebGL2(program, positionBuffer, colorBuffer)
    })
</script>

<canvas bind:this={canvas}></canvas>

<style>
    canvas {
        width: 100vw;
        height: 100vh;
        position: absolute;
        left: 0;
        top: 0;
    }
</style>