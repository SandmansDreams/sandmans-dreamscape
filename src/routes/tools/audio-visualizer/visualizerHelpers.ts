
export type Track = {
    name: string,
    src: string,
    length: number,
}

export interface Setting {
    id: string,
    label: string,
    type: 'range' | 'toggle',
    default: number,
    min?: number,
    max?: number,
    step?: number,
    format?: (v: number) => string;
}

export interface ModeParams {
    ctx: CanvasRenderingContext2D;
    canvasWidth: number;
    canvasHeight: number;
    dataArray: Uint8Array;
    bufferLength: number;
    timestamp: number;
    devicePixelRatio: number;
    values: Record<string, number>; // merged global + this mode's own settings
}

export type VisualizerMode = {
    id: string,
    label: string,
    axisLabels: { top: string; right: string };
    settings: Setting[];
    draw: (params: ModeParams) => void;
}
