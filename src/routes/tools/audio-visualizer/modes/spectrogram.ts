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
      min: 1,
      max: 50,
      step: 1,
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
/*     {
      id: "spectrogramTilt",
      label: "Tilt",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.25,
    }, */
  ],
  draw({ ctx, canvasWidth, canvasHeight, dataArray, bufferLength, values }) {
    const {
      spectrogramSpeed: speed,
      spectrogramResolution: resolution,
      //spectrogramTilt: tilt,
      hue,
      hueRange,
      brightness,
      multiplier,
    } = values;

    // Round values so that it doesn't try to do sub-pixels
    const width = Math.round(canvasWidth);
    const height = Math.round(canvasHeight);

    // Set up spectrogram buffer canvas, first iter creates it, the rest set it
    if (
      !spectrogramBuf ||
      spectrogramBuf.width !== width ||
      spectrogramBuf.height !== height
    ) {
      spectrogramBuf = document.createElement("canvas");
      spectrogramBuf.width = width;
      spectrogramBuf.height = height;
      const bufferContext = spectrogramBuf.getContext("2d")!;
      bufferContext.fillStyle = "black";
      bufferContext.fillRect(0, 0, width, height);
    }
    const bufferContext = spectrogramBuf.getContext("2d")!;
 
    // Round shift to whole pixels also
    const shift = Math.max(
        1,
        Math.min(width - 1, Math.round(speed)),
    );

    bufferContext.drawImage(
      spectrogramBuf,
      shift,
      0,
      width - shift,
      height,
      0,
      0,
      width - shift,
      height,
    );
 
    // Paint over strip at side with background
    bufferContext.fillStyle = "black";
    bufferContext.fillRect(width - shift, 0, shift, height);

    // Creates row info for resolution
    const rowCount = Math.max(
      1,
      Math.min(Math.round(resolution), bufferLength),
    );
    const pixelsPerRow = height / rowCount;

    // Draw the new column of frequency data into that freshly-cleared strip
    for (let row = 0; row < rowCount; row++) {
        const frequencyBinIndex = Math.floor((row / rowCount) * bufferLength);
        const binAmplitude = dataArray[frequencyBinIndex]; // 0-255
        const normalizedAmplitude = binAmplitude / 255; // 0-1
    
        const rowHue = hue + hueRange * normalizedAmplitude;
        const rowLightness = Math.min(
            100,
            normalizedAmplitude * brightness,
        );
        bufferContext.fillStyle = `hsl(${rowHue}, 100%, ${rowLightness}%)`;
    
        // +1px of overdraw on the height avoids visible seams between rows
        // caused by pixelsPerRow not being a whole number.
        const rowTopY = height - (row + 1) * pixelsPerRow;
        bufferContext.fillRect(
            width - shift,
            rowTopY,
            shift,
            pixelsPerRow + 1,
        );
    }

    // Blit the whole (now-shifted, now-updated) buffer to the visible canvas
    ctx.drawImage(spectrogramBuf, 0, 0);
  },
};

export default Spectrogram;
