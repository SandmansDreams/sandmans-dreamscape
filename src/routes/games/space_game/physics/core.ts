export class Vector2 {
    constructor(
        public x = 0,
        public y = 0
    ) {}

    add(other: Vector2) {
        this.x += other.x
        this.y += other.y
        return this;
    }

    subtract(other: Vector2) {
        this.x -= other.x
        this.y -= other.y
        return this;
    }

    multiply(scalar: number) {
        this.x *= scalar
        this.y *= scalar
        return this;
    }

    clone() {
        return new Vector2(this.x, this.y)
    }
}

export class PhysicsObject {
    
}