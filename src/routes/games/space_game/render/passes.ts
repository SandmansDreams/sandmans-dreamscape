import { Assert } from "../diagnostics"
import { Program, Shader } from "./shaders"
import type { RenderTarget } from "./targets"

export class FullscreenPass { // Runs a fragment shader over an entire image
    readonly program: Program
    private readonly vao: WebGLVertexArrayObject

    constructor (
        private readonly gl2: WebGL2RenderingContext,
        vertexGLSL: string,
        fragmentGLSL: string
    ) {
        this.program = new Program(gl2, [
            new Shader(gl2, gl2.VERTEX_SHADER, vertexGLSL),
            new Shader(gl2, gl2.FRAGMENT_SHADER, fragmentGLSL),
        ])

        // An empty VAO. There are no attributes - the vertex shader builds its
        // triangle from gl_VertexID - but something still has to be bound.
        const vao = gl2.createVertexArray()
        Assert.exists(vao, "vao")
        this.vao = vao
    }

    // Draws `input` through this shader into whatever framebuffer is bound.
    draw(input: RenderTarget, configure?: (program: Program) => void) {
        this.program.use()

        // Bind the input image to texture unit 0, and tell the sampler to read unit 0
        this.gl2.activeTexture(this.gl2.TEXTURE0)
        this.gl2.bindTexture(this.gl2.TEXTURE_2D, input.texture)
        this.gl2.uniform1i(this.program.uniform("u_Scene"), 0)

        configure?.(this.program)

        this.gl2.bindVertexArray(this.vao)
        this.gl2.drawArrays(this.gl2.TRIANGLES, 0, 3)
    }
}