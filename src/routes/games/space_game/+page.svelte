<script lang="ts">
    import { onMount } from "svelte";
    import { Mat4, mat4 } from "ts-gl-matrix";
    
    import { randomMatrixColor, resizeWebGL2Context, createWebGL2Buffer, createShader, createWebGL2Pointer, createWebGL2Program} from "./gl2"

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

    function assignWebGL2Pointers(program: WebGLProgram, positionBuffer: WebGLBuffer, colorBuffer: WebGLBuffer) {
        if (!gl2) throw new Error('gl2 not defined at drawWebGL2()')

        // Create pointers to the vertex position data
        createWebGL2Pointer(gl2, program, 'position', positionBuffer)
        createWebGL2Pointer(gl2, program, 'color', colorBuffer)
    }

    function renderFrame(program: WebGLProgram, modelMatrix: Mat4, viewMatrix: Mat4) {
        if (!gl2 || !canvas) throw new Error('gl2 or canvas not defined at renderFrame()')

        const mvMatrix = mat4.create()
        const projectionMatrix = mat4.create()
        const mvpMatrix = mat4.create()
        const uniformLocations = {
            matrix: gl2.getUniformLocation(program, 'matrix')
        }

        mat4.perspectiveNO(
            projectionMatrix,
            75 * Math.PI / 180, // Vertical field of view
            canvas.width / canvas.height, // Aspect ration w/h
            1e-4, // Near cull distance
            1e4 // Far cull distance
        )

        //mat4.rotate(matrix, matrix, Math.PI/2 / 70, [0, 0, 1])
        mat4.rotateZ(modelMatrix, modelMatrix, Math.PI/2 / 50)
        //mat4.rotateX(matrix, matrix, Math.PI/2 / 50)

        mat4.multiply(mvMatrix, viewMatrix, modelMatrix)
        mat4.multiply(mvpMatrix, projectionMatrix, mvMatrix)

        gl2.uniformMatrix4fv(uniformLocations.matrix, false, mvpMatrix)
        gl2.drawArrays(gl2.TRIANGLES, 0, boxVertexData.length / 3)
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

        resizeWebGL2Context(canvas, gl2, .15)
        randomCubeColor()

        const positionBuffer = createWebGL2Buffer(gl2, boxVertexData)
        const colorBuffer = createWebGL2Buffer(gl2, colorData)
        
        const vertexShader = createShader(
            gl2, 
            gl2.VERTEX_SHADER, 
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
        
        const fragmentShader = createShader(
            gl2, 
            gl2.FRAGMENT_SHADER, 
            `precision mediump float;

            varying vec3 vColor;

            void main() {
                gl_FragColor = vec4(vColor, 1);
            }
        `)
        
        const program = createWebGL2Program(gl2, vertexShader, fragmentShader)

        gl2.useProgram(program)
        gl2.enable(gl2.DEPTH_TEST)

        assignWebGL2Pointers(program, positionBuffer, colorBuffer)

        const modelMatrix = mat4.create()
        const viewMatrix = mat4.create()

        mat4.translate(modelMatrix, modelMatrix, [-1.5, 0, -2])
        //mat4.scale(matrix, matrix, [0.25, 0.25, 0.25])

        mat4.translate(viewMatrix, viewMatrix, [-3, 0, 1])
        mat4.invert(viewMatrix, viewMatrix)



        const loop = (time: number) => {
            renderFrame(program, modelMatrix, viewMatrix)
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