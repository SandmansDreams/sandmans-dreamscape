import { Camera } from "./camera"

export class Scene {
    camera: Camera
    //lights: Light[]
    //physicsObjects: PhysicsObject[]
    //staticObjects: StaticObject[]

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly gl2: WebGL2RenderingContext,
    ) {
        this.camera = new Camera()
    }
}
