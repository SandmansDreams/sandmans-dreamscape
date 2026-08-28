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

    normalize() {
        const length = this.getSpeed();

        if (length > 0) {
            this.x /= length;
            this.y /= length;
        }

        return this;
    }

    static fromAngle(angle: number) {
        return new Vector2(
            Math.cos(angle),
            Math.sin(angle)
        )
    }

    getSpeed() {
        return Math.hypot(this.x, this.y)
    }
}