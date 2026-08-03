import type { VertexAttribute } from "./mesh"

const BYTES_PER_FLOAT = 4

export const UNIT_QUAD = new Float32Array([
    -0.5, -0.5,
     0.5, -0.5,
     0.5,  0.5,

    -0.5, -0.5,
     0.5,  0.5,
    -0.5,  0.5,
])

function bindAttributes(
    gl2: WebGL2RenderingContext,
    layout: VertexAttribute[],
    stride: number,
    divisor: number
) {
    let offset = 0
    for (const attribute of layout) {
        gl2.enableVertexAttribArray(attribute.location)
        gl2.vertexAttribPointer(
            attribute.location,
            attribute.size,
            gl2.FLOAT,
            false,
            stride * BYTES_PER_FLOAT,
            offset * BYTES_PER_FLOAT
        )
        // divisor 0 = per vertex (the default), 1 = per instance.
        if (divisor !== 0) gl2.vertexAttribDivisor(attribute.location, divisor)
        offset += attribute.size
    }
}

export class InstancedBatch {
readonly capacity: number

    private readonly vertexArray: WebGLVertexArrayObject
    private readonly baseBuffer: WebGLBuffer
    private readonly instanceBuffer: WebGLBuffer

    /** Preallocated at capacity — refilled each frame, never reallocated. */
    private readonly instanceData: Float32Array
    private readonly floatsPerInstance: number
    private readonly baseVertexCount: number

    private count = 0

    constructor(
        private readonly gl2: WebGL2RenderingContext,
        baseGeometry: Float32Array,
        baseLayout: VertexAttribute[],
        instanceLayout: VertexAttribute[],
        capacity: number
    ) {
        const baseStride = baseLayout.reduce((total, a) => total + a.size, 0)
        this.baseVertexCount = baseGeometry.length / baseStride

        this.floatsPerInstance = instanceLayout.reduce((total, a) => total + a.size, 0)
        this.capacity = capacity
        this.instanceData = new Float32Array(capacity * this.floatsPerInstance)

        const vertexArray = gl2.createVertexArray()
        this.vertexArray = vertexArray
        gl2.bindVertexArray(vertexArray)

        // Base geometry: static, advances per vertex.
        this.baseBuffer = gl2.createBuffer()
        gl2.bindBuffer(gl2.ARRAY_BUFFER, this.baseBuffer)
        gl2.bufferData(gl2.ARRAY_BUFFER, baseGeometry, gl2.STATIC_DRAW)
        bindAttributes(gl2, baseLayout, baseStride, 0)

        // Instance data: rewritten every frame, advances per instance.
        // Allocating by byte length leaves the contents undefined, which is
        // fine — draw() only ever uploads the range it filled.
        this.instanceBuffer = gl2.createBuffer()
        gl2.bindBuffer(gl2.ARRAY_BUFFER, this.instanceBuffer)
        gl2.bufferData(gl2.ARRAY_BUFFER, this.instanceData.byteLength, gl2.DYNAMIC_DRAW)
        bindAttributes(gl2, instanceLayout, this.floatsPerInstance, 1)

        gl2.bindVertexArray(null)
    }

    begin() {
        this.count = 0
    }

    add(x: number, y: number, rotation: number, scale: number, r: number, g: number, b: number) {
        if (this.count >= this.capacity) return

        // Uniform scale folds straight into the rotation vector: the matrix
        // [c -s; s c] scaled by k is [kc -ks; ks kc]. Two floats carry both.
        const c = Math.cos(rotation) * scale
        const s = Math.sin(rotation) * scale

        const i = this.count * this.floatsPerInstance
        const data = this.instanceData

        data[i + 0] = x
        data[i + 1] = y
        data[i + 2] = c
        data[i + 3] = s
        data[i + 4] = r
        data[i + 5] = g
        data[i + 6] = b

        this.count++
    }

    draw() {
        if (this.count === 0) return

        this.gl2.bindVertexArray(this.vertexArray)
        this.gl2.bindBuffer(this.gl2.ARRAY_BUFFER, this.instanceBuffer)

        // The WebGL2 overload takes srcOffset and length in *elements*, so we
        // upload only the filled range without allocating a subarray view.
        this.gl2.bufferSubData(
            this.gl2.ARRAY_BUFFER, 0,
            this.instanceData, 0, this.count * this.floatsPerInstance
        )

        this.gl2.drawArraysInstanced(
            this.gl2.TRIANGLES, 0, this.baseVertexCount, this.count
        )
    }

    dispose() {
        this.gl2.deleteVertexArray(this.vertexArray)
        this.gl2.deleteBuffer(this.baseBuffer)
        this.gl2.deleteBuffer(this.instanceBuffer)
    }
}