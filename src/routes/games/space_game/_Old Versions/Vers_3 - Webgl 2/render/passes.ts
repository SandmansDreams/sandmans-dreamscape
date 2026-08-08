import { Assert } from "../assert"
import { FULLSCREEN_VERTEX_SOURCE, Program, Shader } from "./shaders"
import type { RenderTarget } from "./targets"

export class FullscreenPass { // Runs a fragment shader over an entire image
    readonly program: Program
    private readonly vao: WebGLVertexArrayObject

    constructor (
        private readonly gl2: WebGL2RenderingContext,
        fragmentGLSL: string
    ) {
        this.program = new Program(gl2, [
            new Shader(gl2, gl2.VERTEX_SHADER, FULLSCREEN_VERTEX_SOURCE),
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

        // Both resolutions, since they differ whenever the scene renders at a
        // reduced scale. gl_FragCoord is in destination pixels, so u_Resolution
        // comes from the viewport rather than the input; u_SceneResolution is
        // the input's own size, for anything needing a texel step.
        // Either resolves to null and is skipped if the shader omits it.
        const viewport = this.gl2.getParameter(this.gl2.VIEWPORT) as Int32Array
        this.gl2.uniform2f(this.program.uniform("u_Resolution"), viewport[2], viewport[3])
        this.gl2.uniform2f(this.program.uniform("u_SceneResolution"), input.width, input.height)

        // After the defaults, so a scene can still override either
        configure?.(this.program)

        this.gl2.bindVertexArray(this.vao)
        this.gl2.drawArrays(this.gl2.TRIANGLES, 0, 3)
    }

    dispose() {
        this.gl2.deleteVertexArray(this.vao)
        this.program.dispose()
    }
}