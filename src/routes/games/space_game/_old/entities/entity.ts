import type { Controller } from "../controller"
import { Collider, PhysicsObject, Vector2 } from "../physics"
import type { Camera, DebugOptions } from "../types"

export abstract class Entity extends PhysicsObject { // A thing that has health and is controlled
    currentHealth: number = 100
    maxHealth: number = 100
    controller: Controller
    
    constructor(position: Vector2, velocity: Vector2, rotation = 0, controller: Controller, currentHealth: number = 100, maxHealth: number = 100) {
        super(position, velocity, rotation)
        this.controller = controller
        this.currentHealth = currentHealth
        this.maxHealth = maxHealth
    }

    setHealth(value: number) {
        this.currentHealth = value
    }

    setMaxHealth(value: number) {
        this.maxHealth = value
    }
}

