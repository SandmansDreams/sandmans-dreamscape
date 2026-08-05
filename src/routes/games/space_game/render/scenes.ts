import { Vector2 } from "../physics/core"

export class Scene {
    camera: Camera
    //lights: Light[]
    //physicsObjects: PhysicsObject[]
    //staticObjects: StaticObject[]
    
    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly gl2: WebGL2RenderingContext,
    ) {
        this.camera = new Camera
    }
}

export class Camera {
    postion: Vector2

    constructor (
        position?: Vector2
    ) {
        this.postion = position ?? new Vector2
    }
}