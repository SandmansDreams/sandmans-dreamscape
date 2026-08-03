import { Mat4, mat4 } from "ts-gl-matrix";

export class Camera {
    x = 0
    y = 0
    zoom = 1

    readonly projection: Mat4 = mat4.create()

    update(viewportWidth: number, viewportHeight: number) {
        const halfWidth = viewportWidth / this.zoom / 2
        const halfHeight = viewportHeight / this.zoom / 2

        mat4.orthoNO(
            this.projection,
            this.x - halfWidth,  this.x + halfWidth,    // left, right
            this.y + halfHeight, this.y - halfHeight,   // bottom, top — flipped
            -1, 1
        )
    }
}