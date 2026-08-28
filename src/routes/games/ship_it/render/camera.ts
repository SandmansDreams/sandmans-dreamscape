import { Vector2 } from "../game/physics"
import type { Renderer } from "./webGPU/render"
import { Buffer } from "./webGPU/buffer"

export const CAMERA_FLOATS = 8
export const CAMERA_BYTES = CAMERA_FLOATS * 4

export class Camera {
    position: Vector2 // World position
    zoom: number // At zoom 1, one world unit covers one drawing-buffer pixel
    rotation: number // Radians. Positive turns the WORLD clockwise on screen, i.e. the camera itself clockwise

    viewportWidth = 1
    viewportHeight = 1

    private readonly packed = new Float32Array(CAMERA_FLOATS)

    constructor(position = new Vector2(0, 0), zoom = 1, rotation = 0) {
        this.position = position
        this.zoom = zoom
        this.rotation = rotation
    }

    pack(viewportWidth: number, viewportHeight: number): Float32Array { // Builds camera transform matrix and converts it to a Float32Array for shader consuming
        // Cached for screenToWorld/worldToScreen, which have no viewport of their own
        this.viewportWidth = viewportWidth
        this.viewportHeight = viewportHeight

        // A zero or negative zoom divides to Infinity and collapses every vertex,
        // with no validation error to explain it. Guard instead.
        const zoom = (this.zoom > 0) ? this.zoom : 1

        // Scale factors taking world units to clip space (-1..1). No aspect term is
        // needed: each axis divides by its own viewport dimension, so pixels come out
        // square by construction. The negative on Y is the flip - world y points down,
        // clip y points up.
        const scaleX = (2 * zoom) / viewportWidth
        const scaleY = (-2 * zoom) / viewportHeight

        // Create rotation values in radians for rotation matrix
        const cos = Math.cos(this.rotation)
        const sin = Math.sin(this.rotation)

        // Combine scale and rotation into one 2x2 matrix, M = S · R(-rotation).
        // The rotation goes INSIDE the scale because the negative scaleY is a mirror -
        // composing the other way round flips the direction the camera appears to turn.
        /*      col 0   col 1
                ┌──────┬──────┐
        row 0   │ m00  │ m10  │
                ├──────┼──────┤
        row 1   │ m01  │ m11  │
                └──────┴──────┘
        */

        const matSlot00 = scaleX * cos
        const matSlot01 = scaleY * sin
        const matSlot10 = -scaleX * sin
        const matSlot11 = scaleY * cos

        // Translation precomputed as -M · position, so the shader never sees the
        // camera position - it is two multiply-adds per vertex
        const translationX = -(matSlot00 * this.position.x + matSlot10 * this.position.y)
        const translationY = -(matSlot01 * this.position.x + matSlot11 * this.position.y)

        const out = this.packed

        // Fill slots
        out[0] = matSlot00
        out[1] = matSlot01
        out[2] = matSlot10
        out[3] = matSlot11
        out[4] = translationX
        out[5] = translationY
        out[6] = viewportWidth
        out[7] = viewportHeight

        return out
    }

    /** Moves camera to a world rect and zooms so it fits (ignores rotation) */
    fit(
        left: number,
        top: number,
        right: number,
        bottom: number,
        viewportWidth: number,
        viewportHeight: number,
        margin = 0.05,
    ) {
        const width = Math.max(right - left, 1e-6)
        const height = Math.max(bottom - top, 1e-6)

        this.position.x = (left + right) / 2
        this.position.y = (top + bottom) / 2

        // Whichever axis runs out of room first decides the zoom
        this.zoom = Math.min(viewportWidth / width, viewportHeight / height) * (1 - margin)
    }

    screenToWorld(screenX: number, screenY: number): Vector2 { // Converts screen coordinates to world coordinates for input handling
        const zoom = this.zoom > 0 ? this.zoom : 1
        const cx = (screenX - this.viewportWidth / 2) / zoom
        const cy = (screenY - this.viewportHeight / 2) / zoom

        const cos = Math.cos(this.rotation)
        const sin = Math.sin(this.rotation)

        return new Vector2(
            this.position.x + cos * cx + sin * cy,
            this.position.y - sin * cx + cos * cy,
        )
    }

    worldToScreen(worldX: number, worldY: number): Vector2 { // Converts world coordinates to screen coordinates for interactive elements
        const zoom = this.zoom > 0 ? this.zoom : 1
        const dx = worldX - this.position.x
        const dy = worldY - this.position.y

        const cos = Math.cos(this.rotation)
        const sin = Math.sin(this.rotation)

        return new Vector2(
            (cos * dx - sin * dy) * zoom + this.viewportWidth / 2,
            (sin * dx + cos * dy) * zoom + this.viewportHeight / 2
        )
    }

}

// The GPU side of the camera with buffers and bindings
// Binds camera to group 0 so every render pipeline in worldspace can use it
export class CameraBinding {
    readonly layout: GPUBindGroupLayout
    readonly group: GPUBindGroup
    private readonly buffer: Buffer

    private constructor(layout: GPUBindGroupLayout, group: GPUBindGroup, buffer: Buffer) {
        this.layout = layout
        this.group = group
        this.buffer = buffer
    }

    static create(renderer: Renderer, label = "camera"): CameraBinding {
        const layout = renderer.gpu.createBindGroupLayout({
            label: `${label} layout`,
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
        })

        const buffer = Buffer.makeUniformBuffer(renderer, CAMERA_BYTES, `${label} buffer`)

        const group = renderer.gpu.createBindGroup({
            label: `${label} group`,
            layout,
            entries: [{ binding: 0, resource: { buffer: buffer.handle } }],
        })

        return new CameraBinding(layout, group, buffer)
    }

    upload(camera: Camera, viewportWidth: number, viewportHeight: number): void {
        this.buffer.write(camera.pack(viewportWidth, viewportHeight) as ArrayBufferView<ArrayBuffer>)
    }

    destroy(): void {
        this.buffer.destroy()
    }
}