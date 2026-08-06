import type { Vec3Like } from "ts-gl-matrix";
import { Buffer } from "./shaders";
import { Assert } from "../assert";

// Gets the attibute from the location, should be moved to shader
export const ATTR_VERTEX = 0 
export const ATTR_COLOR = 1 
const FLOATS_PER_VERTEX = 5          // x, y, r, g, b
const STRIDE = FLOATS_PER_VERTEX * 4 // bytes

export class Mesh {
    private readonly vao: WebGLVertexArrayObject
    private readonly buffer: Buffer
    vertexCount: number

    constructor(
        private readonly gl2: WebGL2RenderingContext,
        data: number[] | Float32Array,
        drawType?: GLenum
    ) {
        Assert.that(
            data.length % FLOATS_PER_VERTEX === 0,
            `Mesh data length ${data.length} is not a multiple of ${FLOATS_PER_VERTEX}`
        )
        this.vertexCount = data.length / FLOATS_PER_VERTEX

        const vao = gl2.createVertexArray()
        Assert.exists(vao, "vao")
        this.vao = vao

        gl2.bindVertexArray(vao)                      // VAO starts recording
        this.buffer = new Buffer(gl2, data, drawType) // creates, binds, uploads

        gl2.enableVertexAttribArray(ATTR_VERTEX)
        gl2.vertexAttribPointer(ATTR_VERTEX, 2, gl2.FLOAT, false, STRIDE, 0)

        gl2.enableVertexAttribArray(ATTR_COLOR)
        gl2.vertexAttribPointer(ATTR_COLOR, 3, gl2.FLOAT, false, STRIDE, 2 * 4)

        gl2.bindVertexArray(null)           // stop recording
    }

    // Re-uploads the vertex data into the existing buffer. The attribute
    // layout is unchanged, so the VAO stays valid - this is how you animate
    // geometry without recreating a VAO and VBO every frame.
    update(data: number[] | Float32Array) {
        Assert.that(
            data.length % FLOATS_PER_VERTEX === 0,
            `Mesh data length ${data.length} is not a multiple of ${FLOATS_PER_VERTEX}`
        )
        this.vertexCount = data.length / FLOATS_PER_VERTEX
        this.buffer.passData(data)
    }

    draw() {
        this.gl2.bindVertexArray(this.vao)
        this.gl2.drawArrays(this.gl2.TRIANGLES, 0, this.vertexCount)
    }

    dispose() {
        this.gl2.deleteVertexArray(this.vao)
        this.buffer.dispose()
    }
}

// May Delete
export type Color = readonly [number, number, number]

export class MeshBuilder { // Accumulates triangles on the CPU, uploads once
    private readonly data: number[] = []

    /** verts: flat [x,y, x,y, x,y, ...] triangle list. The color is copied to every vertex. */
    add(verts: readonly number[], color: Color): this {
        Assert.that(verts.length % 6 === 0, "verts must be whole triangles")

        for (let i = 0; i < verts.length; i += 2) {
            this.data.push(verts[i], verts[i + 1], color[0], color[1], color[2])
        }
        return this
    }

    build(gl2: WebGL2RenderingContext): Mesh {
        return new Mesh(gl2, this.data)
    }
}