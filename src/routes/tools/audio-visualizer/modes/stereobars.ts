import type { VisualizerMode } from "../visualizerHelpers";
import { fillCanvas } from "../visualizerHelpers";

const StereoBars: VisualizerMode = {
  id: "mirror",
  label: "Mirror",
  dataType: "frequency",
  axisLabels: { vertical: "AMPLITUDE", horizontal: "FREQUENCY (LOW → HIGH)" },
  settings: [
      {
      id: "stereoBarCount",
      label: "Bars",
      min: 1,
      max: 1024,
      step: 1,
      default: 64,
    },
    {
      id: "stereoWidth",
      label: "Bar Width",
      min: 0.1,
      max: 1.5,
      step: 0.1,
      default: 1,
      format: (v) => `${v}x`,
    },
    {
      id: "stereoTilt",
      label: "Tilt",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.25,
    },
    {
      id: "stereoAmpNumbers",
      label: "Amp Numbers",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      format: (v) => `${v === 0 ? "OFF" : "ON" }`,
    },
    {
      id: "stereoFontSize",
      label: "Font Size",
      min: 1,
      max: 200,
      step: 1,
      default: 14,
      format: (v) => `${v}pt`,
    }
  ],
  draw({ ctx, canvasWidth, canvasHeight, dataArray, bufferLength, values }) {
    const { 
      stereoBarCount: barCount,
      stereoWidth: widthMult,
      stereoTilt: tilt,
      stereoAmpNumbers: ampNumbers,
      stereoFontSize: fontSize,
      hue,
      hueRange,
      brightness,
      multiplier,
     } = values;

    fillCanvas(fade);

    const barCount = 96;
    const step = Math.floor(bufferLength / barCount);
    const barWidth = canvasWidth / barCount;
    const midY = canvasHeight / 2;

    for (let i = 0; i < barCount; i++) {
      const v = dataArray[i * step] / 255;
      const barH = v * (canvasHeight / 2) * 0.9;
      ctx.fillStyle = `hsla(160, 90%, ${45 + v * 25}%, 0.9)`;
      ctx.fillRect(i * barWidth + 1, midY - barH, barWidth - 2, barH * 2);
    }

    ctx.strokeStyle = "rgba(107,255,158,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(canvasWidth, midY);
    ctx.stroke();
  },
};

export default StereoBars;
