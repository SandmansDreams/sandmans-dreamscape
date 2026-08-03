import type { Vec3Like } from "ts-gl-matrix"

export function randomMat3NO(): Vec3Like { // Returns a random 3 float matrix between -1 and 1
    return [
        (Math.random() - 0.5) * 2, 
        (Math.random() - 0.5) * 2, 
        (Math.random() - 0.5) * 2
    ]
}

export function randomMat3ZO(): Vec3Like { // Returns a random 3 float matrix between 0 and 1
    return [
        Math.random(), 
        Math.random(), 
        Math.random()
    ]
}