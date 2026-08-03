import { Mat4, mat4 } from "ts-gl-matrix";

export class Camera {
    x = 0
    y = 0
    zoom = 1

    readonly projection: Mat4 = mat4.create()

    update(viewportWidth: number, viewportHeight: number) {
        // A zero or negative zoom divides to Infinity, and ortho() then turns
        // that into a matrix of zeros and NaNs — every vertex collapses and
        // nothing draws, with no GL error to explain it. Clamp instead.
        const zoom = this.zoom > 0 ? this.zoom : 1

        const halfWidth = viewportWidth / zoom / 2
        const halfHeight = viewportHeight / zoom / 2

        mat4.orthoNO(
            this.projection,
            this.x - halfWidth,  this.x + halfWidth,    // left, right
            this.y + halfHeight, this.y - halfHeight,   // bottom, top — flipped
            -1, 1
        )
    }
}