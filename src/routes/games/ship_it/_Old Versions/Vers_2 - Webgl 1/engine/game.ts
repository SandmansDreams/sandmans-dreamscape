import { Camera } from "./camera"

export class Game {
    canvasElement: HTMLCanvasElement
    gl2: WebGL2RenderingContext
    renderScale: number
    camera = new Camera()
    cssWidth = 1
    cssHeight = 1

    constructor(
        canvasElement: HTMLCanvasElement,
        renderScale?: number
    ) {
        this.canvasElement = canvasElement
        if (!this.canvasElement) throw new Error("'canvas' not found in Game class at constructor()")

        const gl2Context = canvasElement.getContext("webgl2")
        if (!gl2Context) throw new Error("'gl2' not found in Game class at constructor()")
        this.gl2 = gl2Context

        this.gl2.enable(this.gl2.BLEND)
        this.gl2.blendFunc(this.gl2.SRC_ALPHA, this.gl2.ONE_MINUS_SRC_ALPHA)

        this.renderScale = renderScale ?? 1
        this.resizeCanvas()
    }

    resizeCanvas() {
        const rect = this.canvasElement.getBoundingClientRect()
        this.cssHeight = rect.height
        this.cssWidth = rect.width

        const dpr = window.devicePixelRatio || 1

        const width = Math.max(1, Math.round(rect.width * dpr * this.renderScale))
        const height = Math.max(1, Math.round(rect.height * dpr * this.renderScale))

        // Don't change unless different
        if (this.canvasElement.width === width && this.canvasElement.height === height) return false

        this.canvasElement.width = width
        this.canvasElement.height = height
        this.gl2.viewport(0, 0, width, height)
        return true
    }

    setRenderScale(scale: number) {
        this.renderScale = scale 
    }

    update() {
        this.resizeCanvas()
        this.camera.update(this.cssWidth, this.cssHeight)
        this.gl2.clear(this.gl2.COLOR_BUFFER_BIT)

        // Draw
    }
}