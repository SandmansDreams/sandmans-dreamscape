import type { VisualizerMode } from "../visualizerHelpers";

let spectrogramBuf: HTMLCanvasElement | null = null;

const Spectrogram: VisualizerMode = {
  id: "spectrogram",
  label: "Spectrogram",
  dataType: "frequency",
  axisLabels: { horizontal: "TIME", vertical: "FREQUENCY (LOW → HIGH)" },
  settings: [
    {
      id: "spectrogramSpeed",
      label: "Speed",
      min: 0.5,
      max: 300,
      step: 0.5,
      default: 1,
      format: (v) => `${v}x`,
    },
    {
      id: "spectrogramResolution",
      label: "Resolution",
      min: 1,
      max: 1024,
      step: 1,
      default: 1024,
    },
    {
      id: "spectrogramTilt",
      label: "Tilt",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.25,
    },
  ],
  draw({ ctx, canvasWidth, canvasHeight, dataArray, bufferLength, values }) {
    const {
      spectrogramSpeed: speed,
      spectrogramResolution: resolution,
      spectrogramTilt: tilt,
      hue,
      hueRange,
      brightness,
      multiplier,
    } = values;

    const w = Math.round(canvasWidth);
    const h = Math.round(canvasHeight);

    // Set up spectrogram buffer canvas
    if (
      !spectrogramBuf ||
      spectrogramBuf.width !== w ||
      spectrogramBuf.height !== h
    ) {
      spectrogramBuf = document.createElement("canvas");
      spectrogramBuf.width = w;
      spectrogramBuf.height = h;
      const bctx = spectrogramBuf.getContext("2d")!;
      bctx.fillStyle = "black";
      bctx.fillRect(0, 0, w, h);
    }
    const bctx = spectrogramBuf.getContext("2d")!;
 
    const shift = speed;
 
    bctx.drawImage(
      spectrogramBuf,
      shift,
      0,
      canvasWidth - shift,
      canvasHeight,
      0,
      0,
      canvasWidth - shift,
      canvasHeight,
    );
 
    // Paint the newly-exposed strip at the right edge with the background
    // color before drawing new data into it.
    bctx.fillStyle = "black";
    bctx.fillRect(canvasWidth - shift, 0, shift, canvasHeight);
 
    const bins = bufferLength;
 
    // Draw the new column of frequency data into that freshly-cleared strip
    for (let y = 0; y < bins; y++) {
      const amplitude = dataArray[y];
 
      const hueY = hue + Math.round(hueRange * amplitude);
      const lightness = (amplitude / 255) * brightness;
      bctx.fillStyle = `hsl(${hueY}, 100%, ${lightness}%)`;
      bctx.fillRect(canvasWidth - shift, canvasHeight - y, Math.max(1, speed), Math.max(1, multiplier));
    }
 
    // Blit the whole (now-shifted, now-updated) buffer to the display canvas
    ctx.drawImage(spectrogramBuf, 0, 0);
  },
};

export default Spectrogram;
