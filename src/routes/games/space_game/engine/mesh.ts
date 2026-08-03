const BYTES_PER_FLOAT = 4

export interface VertexAttribute {
    location: number,
    size: number,
    type?: GLenum,
    normalized?: boolean
}

export class Mesh {
    vertexArray: WebGLVertexArrayObject
    vertexCount: number
    buffer: WebGLBuffer

    constructor (
        private readonly gl2: WebGL2RenderingContext,
        data: Float32Array,
        layout: VertexAttribute[],
        usage: GLenum = gl2.STATIC_DRAW
    ) {
        // Floats per vertex, summed across every attribute
        const stride = layout.reduce((total, attribute) => total + attribute.size, 0)
        if (stride === 0)  throw new Error("Mesh layout describes no attributes at Mesh constructor")

        this.vertexCount = data.length / stride

        const vertexArrayObject = this.gl2.createVertexArray()
        if (!vertexArrayObject) throw new Error("gl2.createVertexArray() returned null at Mesh constructor")
        this.vertexArray = vertexArrayObject

        const buffer = this.gl2.createBuffer()
        if (!buffer) throw new Error("gl2.createBuffer() returned null in Mesh constructor")
        this.buffer = buffer

        this.gl2.bindVertexArray(vertexArrayObject)
        this.gl2.bindBuffer(this.gl2.ARRAY_BUFFER, buffer)
        this.gl2.bufferData(this.gl2.ARRAY_BUFFER, data, usage)

        let offset = 0
        for (const attribute of layout) {
            this.gl2.enableVertexAttribArray(attribute.location)
            this.gl2.vertexAttribPointer(
                attribute.location,
                attribute.size,
                this.gl2.FLOAT,
                false,                            // normalized: ignored for floats
                stride * BYTES_PER_FLOAT,         // bytes between consecutive vertices
                offset * BYTES_PER_FLOAT          // bytes from vertex start to this 
            )

            offset += attribute.size
        }

        this.gl2.bindVertexArray(null)
    }

    draw(mode: GLenum = this.gl2.TRIANGLES) {
        this.gl2.bindVertexArray(this.vertexArray)
        this.gl2.drawArrays(mode, 0, this.vertexCount)
    }

    dispose() {
        this.gl2.deleteVertexArray(this.vertexArray)
        this.gl2.deleteBuffer(this.buffer)
    }
}