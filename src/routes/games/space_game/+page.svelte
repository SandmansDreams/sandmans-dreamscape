<script lang="ts">
    import { onMount } from "svelte";
    import { Mat4, mat4, vec3 } from "ts-gl-matrix";
    
    import { randomMat3NO, randomMat3ZO, resizeWebGL2Context, createWebGL2Buffer, createShader, createWebGL2Pointer, createWebGL2Program } from "./gl2"

    let canvas = $state<HTMLCanvasElement | null>(null)
    let gl2 = $state<WebGL2RenderingContext | null>(null)

    let frameId = 0

    const vertexData = [
        // Front
        0.5, 0.5, 0.5, // top right 
        0.5, -.5, 0.5, // bottom right
        -.5, 0.5, 0.5, // top left
        -.5, 0.5, 0.5, // top left
        0.5, -.5, 0.5, // bottom right
        -.5, -.5, 0.5, // bottom left

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

        0.5, 0.5, -.5,
        0.5, -.5, -.5,
        0.5, 0.5, 0.5,
        0.5, 0.5, 0.5,
        0.5, -.5, -0.5,
        0.5, -.5, 0.5,

        // Top
        0.5, 0.5, 0.5,
        0.5, 0.5, -.5,
        -.5, 0.5, 0.5,
        -.5, 0.5, 0.5,
        0.5, 0.5, -.5,
        -.5, 0.5, -.5,

        // Underside
        0.5, -.5, 0.5,
        0.5, -.5, -.5,
        -.5, -.5, 0.5,
        -.5, -.5, 0.5,
        0.5, -.5, -.5,
        -.5, -.5, -.5,
    ];

    let colorData: number[] = []

    function renderFrame(program: WebGLProgram, modelMatrix: Mat4, viewMatrix: Mat4, normalMatrix: Mat4, projectionMatrix: Mat4, matrixUniformLocation: WebGLUniformLocation, normalUniformLocation: WebGLUniformLocation) {
        if (!gl2 || !canvas) throw new Error('gl2 or canvas not defined at renderFrame()')

        const mvMatrix = mat4.create()
        const mvpMatrix = mat4.create()

        //mat4.rotate(matrix, matrix, Math.PI/2 / 70, [0, 0, 1])
        mat4.rotateZ(modelMatrix, modelMatrix, Math.PI/2 / 100)
        mat4.rotateX(modelMatrix, modelMatrix, Math.PI/2 / 200)
        mat4.rotateY(modelMatrix, modelMatrix, Math.PI/2 / 50)

        mat4.multiply(mvMatrix, viewMatrix, modelMatrix)
        mat4.multiply(mvpMatrix, projectionMatrix, modelMatrix)

        mat4.invert(normalMatrix, mvMatrix)
        mat4.transpose(normalMatrix, normalMatrix)

        gl2.uniformMatrix4fv(matrixUniformLocation, false, mvpMatrix)
        gl2.uniformMatrix4fv(normalUniformLocation, false, normalMatrix)

        gl2.drawArrays(gl2.TRIANGLES, 0, vertexData.length / 3)
    }

    function randomCubeColor() {
        let cubeColor = randomMat3ZO()
        for (let face = 0; face < 6; face++) {
            for (let vertex = 0; vertex < 6; vertex++) {
                colorData.push(...cubeColor)
            }
        }
    }

    function spherePointCloud(pointCount: number) {
        let points: number[] = []

        for (let index = 0; index < pointCount; index++) {
            const point = randomMat3NO()
            const outputPoint = vec3.normalize(vec3.create(), point)

            points.push(...outputPoint)
        }

        return points
    }

    function repeat(n: number, pattern: any) {
        return [...Array(n)].reduce(sum => sum.concat(pattern), [])
    }

/*     const uvData = repeat(6, [
        1, 1, // Top right
        1, 0, // Bottom right
        0, 1, // Top Left
        0, 1, // Top Left
        1, 0, // Bottom Right
        0, 0, // Bottom Left
    ]) */

    const normalData = [
        ...repeat(6, [ 0,  0,  1]), // +Z
        ...repeat(6, [-1,  0,  0]), // -X
        ...repeat(6, [ 0,  0, -1]), // -Z
        ...repeat(6, [ 1,  0,  0]), // +X
        ...repeat(6, [ 0,  1,  0]), // +Y
        ...repeat(6, [ 0, -1,  0]), // -Y
    ]

    onMount (() => {
        if (!canvas) throw new Error('canvas not defined at onMount()')

        gl2 = canvas.getContext("webgl2")
        if (!gl2) {
            throw new Error('WebGL2 not supported')
        }

        resizeWebGL2Context(canvas, gl2, 1)
        randomCubeColor()

        const positionBuffer = createWebGL2Buffer(gl2, vertexData)
        const colorBuffer = createWebGL2Buffer(gl2, colorData)
        //const uvBuffer = createWebGL2Buffer(gl2, uvData)
        const normalBuffer = createWebGL2Buffer(gl2, normalData)
        
        const vertexShader = createShader(
            gl2, 
            gl2.VERTEX_SHADER, 
            `precision mediump float;

            const vec3 lightDirection = normalize(vec3(0, 1.0, 1.0));

            attribute vec3 position;
            attribute vec3 color;
            attribute vec3 normal;

            varying vec3 vColor;
            varying float vBrightness;

            uniform mat4 matrix;
            uniform mat4 normalMatrix;

            void main() {
                vec3 worldNormal = (normalMatrix * vec4(normal, 0.0)).xyz;
                float diffuse = max(0.2, dot(worldNormal, lightDirection));

                vBrightness = diffuse;
                vColor = color;
                gl_Position = matrix * vec4(position, 1);
            }
        `)
        
        const fragmentShader = createShader(
            gl2, 
            gl2.FRAGMENT_SHADER, 
            `precision mediump float;

            varying vec3 vColor;
            varying float vBrightness;

            void main() {
                gl_FragColor = vec4(vColor * vBrightness, 1.0);
            }
        `)
        
        const program = createWebGL2Program(gl2, vertexShader, fragmentShader)

        gl2.useProgram(program)
        gl2.enable(gl2.DEPTH_TEST)

        createWebGL2Pointer(gl2, program, 'position', positionBuffer)
        createWebGL2Pointer(gl2, program, 'color', colorBuffer)
        //createWebGL2Pointer(gl2, program, 'uv', uvBuffer)
        createWebGL2Pointer(gl2, program, 'normal', normalBuffer)

        const modelMatrix = mat4.create()
        const viewMatrix = mat4.create()

        mat4.translate(modelMatrix, modelMatrix, [0, 0, -2])
        //mat4.scale(matrix, matrix, [0.25, 0.25, 0.25])

        //mat4.translate(viewMatrix, viewMatrix, [-3, 0, 1])
        mat4.invert(viewMatrix, viewMatrix)

        const normalMatrix = mat4.create()

        const uniformLocations = {
            matrix: gl2.getUniformLocation(program, 'matrix'),
            normalMatrix: gl2.getUniformLocation(program, 'normalMatrix')
        }

        if (!uniformLocations.matrix || !uniformLocations.normalMatrix) throw new Error('a uniformLocation not defined at onMount()')

        const projectionMatrix = mat4.create()

        mat4.perspectiveNO(
            projectionMatrix,
            75 * Math.PI / 180, // Vertical field of view
            canvas.width / canvas.height, // Aspect ration w/h
            1e-4, // Near cull distance
            1e4 // Far cull distance
        )

        const loop = (time: number) => {
            renderFrame(program, modelMatrix, viewMatrix, normalMatrix, projectionMatrix, uniformLocations.matrix, uniformLocations.normalMatrix)
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