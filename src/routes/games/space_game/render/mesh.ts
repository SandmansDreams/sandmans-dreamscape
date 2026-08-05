import type { Vec3Like } from "ts-gl-matrix";
import { Buffer } from "./shaders";
import { Assert } from "../diagnostics";

export const ATTR_VERTEX = 0
export const ATTR_COLOR = 1
const FLOATS_PER_VERTEX = 5          // x, y, r, g, b
const STRIDE = FLOATS_PER_VERTEX * 4 // bytes

export class Mesh {
    private readonly vao: WebGLVertexArrayObject
    private readonly buffer: Buffer
    readonly vertexCount: number

    constructor(
        private readonly gl2: WebGL2RenderingContext,
        data: number[]
    ) {
        this.vertexCount = data.length / FLOATS_PER_VERTEX

        const vao = gl2.createVertexArray()
        Assert.exists(vao, "vao")
        this.vao = vao

        gl2.bindVertexArray(vao)            // VAO starts recording
        this.buffer = new Buffer(gl2, data) // creates, binds, uploads

        gl2.enableVertexAttribArray(ATTR_VERTEX)
        gl2.vertexAttribPointer(ATTR_VERTEX, 2, gl2.FLOAT, false, STRIDE, 0)

        gl2.enableVertexAttribArray(ATTR_COLOR)
        gl2.vertexAttribPointer(ATTR_COLOR, 3, gl2.FLOAT, false, STRIDE, 2 * 4)

        gl2.bindVertexArray(null)           // stop recording
    }

    draw() {
        this.gl2.bindVertexArray(this.vao)
        this.gl2.drawArrays(this.gl2.TRIANGLES, 0, this.vertexCount)
    }
}