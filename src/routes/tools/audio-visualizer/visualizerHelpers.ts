
export type Track = {
    name: string,
    src: string,
}

export type Playlist = {
    id: string,
    name: string,
    tracks: Track[]
}

export interface Setting {
    id: string,
    label: string,
    default: number,
    min: number,
    max: number,
    step: number,
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
    frameId?: number
}

export type VisualizerMode = {
    id: string,
    label: string,
    axisLabels: { horizontal: string; vertical: string };
    settings: Setting[];
    draw: (params: ModeParams) => void;
}