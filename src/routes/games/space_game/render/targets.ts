import { Assert } from "../assert"


export class RenderTarget { // Offscreen framebuffer for texture sampling post-effects
    readonly framebuffer: WebGLFramebuffer
    readonly texture: WebGLTexture
    width = 0
    height = 0

    constructor (
        private readonly gl2: WebGL2RenderingContext,
        width: number,
        height: number,
        private readonly filter: GLenum = gl2.NEAREST
    ) {
        const texture = gl2.createTexture()
        Assert.exists(texture, "texture")
        this.texture = texture

        const framebuffer = gl2.createFramebuffer()
        Assert.exists(framebuffer, "framebuffer")
        this.framebuffer = framebuffer

        this.allocate(width, height)

        // Point the framebuffer's color slot at our texture
        gl2.bindFramebuffer(gl2.FRAMEBUFFER, framebuffer)
        gl2.framebufferTexture2D(
            gl2.FRAMEBUFFER,
            gl2.COLOR_ATTACHMENT0,
            gl2.TEXTURE_2D,
            texture,
            0 // mip level
        )

        const status = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER)
        if (status !== gl2.FRAMEBUFFER_COMPLETE) {
            throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`)
        }

        gl2.bindFramebuffer(gl2.FRAMEBUFFER, null) // Back to the canvas
    }

    private allocate(width: number, height: number) {
        this.width = width
        this.height = height

        this.gl2.bindTexture(this.gl2.TEXTURE_2D, this.texture)
        this.gl2.texImage2D(
            this.gl2.TEXTURE_2D,
            0,                      // mip level
            this.gl2.RGBA8,         // how the GPU stores it
            width, height,
            0,                      // border, always 0
            this.gl2.RGBA,          // format of the source pixels
            this.gl2.UNSIGNED_BYTE, // type of the source pixels
            null                    // no source pixels - just reserve the space
        )

        this.gl2.texParameteri(this.gl2.TEXTURE_2D, this.gl2.TEXTURE_MIN_FILTER, this.filter)
        this.gl2.texParameteri(this.gl2.TEXTURE_2D, this.gl2.TEXTURE_MAG_FILTER, this.filter)

        // Required: the aberration shader deliberately samples outside 0..1.
        // The default (REPEAT) would wrap those reads to the opposite edge.
        this.gl2.texParameteri(this.gl2.TEXTURE_2D, this.gl2.TEXTURE_WRAP_S, this.gl2.CLAMP_TO_EDGE)
        this.gl2.texParameteri(this.gl2.TEXTURE_2D, this.gl2.TEXTURE_WRAP_T, this.gl2.CLAMP_TO_EDGE)
    }

    resize(width: number, height: number) {
        if (width === this.width && height === this.height) return
        this.allocate(width, height)
    }

    bind() { // Subsequent draws land in this target
        this.gl2.bindFramebuffer(this.gl2.FRAMEBUFFER, this.framebuffer)
        this.gl2.viewport(0, 0, this.width, this.height)
    }

    static bindCanvas(gl2: WebGL2RenderingContext, width: number, height: number) {
        gl2.bindFramebuffer(gl2.FRAMEBUFFER, null) // null = the canvas
        gl2.viewport(0, 0, width, height)
    }
}