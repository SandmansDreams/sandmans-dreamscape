import type { VisualizerMode } from "../visualizerHelpers";

const Bars: VisualizerMode = {
  id: "bars",
  label: "Bars",
  dataType: "frequency",
  axisLabels: { vertical: "AMPLITUDE", horizontal: "FREQUENCY (LOW → HIGH)" },
  settings: [
    {
      id: "barsBarCount",
      label: "Bars",
      min: 1,
      max: 1024,
      step: 1,
      default: 64,
    },
    {
      id: "barsWidth",
      label: "Bar Width",
      min: 0.1,
      max: 1.5,
      step: 0.1,
      default: 1,
      format: (v) => `${v}x`,
    },
    {
      id: "barsTilt",
      label: "Tilt",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.25,
    },
    {
      id: "barsAmpNumbers",
      label: "Amp Numbers",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      format: (v) => `${v === 0 ? "OFF" : "ON" }`,
    },
    {
      id: "barsFontSize",
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
      barsBarCount: barCount,
      barsWidth: widthMult,
      barsTilt: tilt,
      barsAmpNumbers: ampNumbers,
      barsFontSize: fontSize,
      hue,
      hueRange,
      brightness,
      multiplier,
    } = values;
    const baseWidth = canvasWidth / barCount;
    const barWidth = baseWidth * widthMult;
    const step = Math.floor(bufferLength / barCount);
    const minLightness = 15;

    for (let i = 0; i < barCount; i++) {
      const amplitude = dataArray[i * step] / 255;

      if (amplitude === 0) continue;

      const tiltFactor = (i * tilt) / barCount;
      const tiltAmp = amplitude + tiltFactor;

      const barHeight = tiltAmp * canvasHeight * multiplier;
      const barHue = hue + amplitude * 100 + (i * hueRange) / (0.5 * barCount);

      ctx.fillStyle = `hsl(${barHue}, 100%, ${minLightness + amplitude * (brightness - minLightness)}%)`;
      ctx.fillRect(
        i * baseWidth,
        canvasHeight - barHeight,
        barWidth,
        barHeight,
      );

      if (!ampNumbers) continue;

      ctx.font = `${fontSize}px 'Space Mono', monospace`;
      ctx.textAlign = "center";
      ctx.fillText(
        `${Math.round(amplitude * 100)}`,
        (i * barWidth) + barWidth / 2, 
        (canvasHeight - barHeight) - 10
      );
    }
  },
};

export default Bars;
