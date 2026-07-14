export type Button = {
    id: string
    name: string
    url: string
    src: string
}

export type Node = Button & {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
}

export type Link = {
    id: string;
    from: Node;
    to: Node;
}

export function getRandomCenterPoint(canvas: HTMLCanvasElement) {
    const wc = canvas.clientWidth / 2
    const hc = canvas.clientHeight / 2
    const x = (Math.random() - .5) * 500 + wc
    const y = (Math.random() - .5) * 500 + hc
    return {x: x, y: y}
}
