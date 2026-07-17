import type { VisualizerMode } from "../visualizerHelpers";

let stereoBuf: HTMLCanvasElement | null = null;

function getEnergy(data: Uint8Array): number {
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    let value = data[i] / 255;
    sum += value * value;
  }

  return Math.sqrt(sum / data.length);
}

function sigmoidCurve(x: number, steepness: number, midpoint: number): number {
  const sigmoid = (t: number) => 1 / (1 + Math.exp(-steepness * (t - midpoint)))

  const y0 = sigmoid(0)
  const y1 = sigmoid(1)
  return (sigmoid(x) - y0) / (y1 - y0);
}

const Stereo: VisualizerMode = {
  id: "stereo",
  label: "Stereo",
  dataType: "time",
  axisLabels: { vertical: "AMPLITUDE (LEFT | RIGHT)", horizontal: "FREQUENCY (LOW → HIGH)" },
  settings: [
    {
      id: "stereoSpeed",
      label: "Speed",
      min: 1,
      max: 50,
      step: 1,
      default: 1,
      format: (v) => `${v}x`,
    },
    {
      id: "stereoEmphasis",
      label: "Emphasis",
      min: 0.1,
      max: 10,
      step: 0.1,
      default: 1,
      format: (v) => `${v}x`,
    },
    {
      id: "stereoThreshold",
      label: "Threshold",
      min: 0.01,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
  ],
  draw({ ctx, canvasWidth, canvasHeight, leftArray, rightArray, values, frameId }) {
    const {
      stereoSpeed: speed,
      stereoEmphasis: emphasis,
      stereoThreshold: threshold,
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
      !stereoBuf ||
      stereoBuf.width !== width ||
      stereoBuf.height !== height
    ) {
      stereoBuf = document.createElement("canvas");
      stereoBuf.width = width;
      stereoBuf.height = height;
      const bufferContext = stereoBuf.getContext("2d")!;
      bufferContext.fillStyle = "black";
      bufferContext.fillRect(0, 0, width, height);
    }
    const bufferContext = stereoBuf.getContext("2d")!;
 
    // Round shift to whole pixels also
    const shift = Math.max(
        1,
        Math.min(width - 1, Math.round(speed)),
    );

    bufferContext.drawImage(
      stereoBuf,
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
    const minLightness = 15;

    // Draw the new column of amp data into that freshly-cleared strip
    const halfHeight = height / 2 // Get the middle point of the canvas

    // Draw left bar
    const leftPeak = getEnergy(leftArray)
    const leftEmphasizedPeak = sigmoidCurve(leftPeak, emphasis, threshold) * ((leftPeak + 0.5) * emphasis)
    const leftHeight = (leftEmphasizedPeak * halfHeight) * multiplier
    const leftHue = hue + (hueRange * leftPeak)
    const leftLightness = Math.max(minLightness, leftPeak * brightness)

    bufferContext.fillStyle = `hsl(${leftHue}, 100%, ${leftLightness}%)`
    bufferContext.fillRect(
      width - shift,
      halfHeight - leftHeight,
      shift,
      leftHeight
    )

    // Draw right bar
    const rightPeak = getEnergy(rightArray)
    const rightEmphasizedPeak = sigmoidCurve(rightPeak, emphasis, threshold) * ((rightPeak + 0.5) * emphasis)
    const rightHeight = (rightEmphasizedPeak * halfHeight) * multiplier
    const rightHue = hue + (hueRange * rightPeak)
    const rightLightness = Math.max(minLightness, rightPeak * brightness)

    bufferContext.fillStyle = `hsl(${rightHue}, 100%, ${rightLightness}%)`
    bufferContext.fillRect(
      width - shift,
      halfHeight - 1,
      shift,
      rightHeight
    )
    

    // Blit the whole (now-shifted, now-updated) buffer to the visible canvas
    ctx.drawImage(stereoBuf, 0, 0);
  },
};

export default Stereo;
