import type { VisualizerMode } from "../visualizerHelpers";

const Bars: VisualizerMode = {
  id: "bars",
  label: "Bars",
  axisLabels: { right: "AMPLITUDE", top: "FREQUENCY (LOW → HIGH)" },
  settings: [
    {
      id: "barCount",
      type: "range",
      label: "Bars",
      min: 1,
      max: 1024,
      step: 1,
      default: 64,
    },
    {
      id: "barWidth",
      type: "range",
      label: "Bar Width",
      min: 0.1,
      max: 1.5,
      step: 0.1,
      default: 1,
      format: (v) => `${v}x`,
    },
    {
      id: "tilt",
      type: "range",
      label: "Tilt",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.25,
    },
    {
      id: "ampNumbers",
      type: "toggle",
      label: "Amp Numbers",
      default: 0, 
      format: (v) => `${v === 0 ? "OFF" : "ON" }`,
    },
  ],
  draw({ ctx, canvasWidth, canvasHeight, dataArray, bufferLength, values }) {
    const {
      barCount,
      barWidth: widthMult,
      tilt,
      ampNumbers,
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
      const tiltAmp = amplitude + (i * tilt) / barCount;
      if (tiltAmp === 0) continue;

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

      ctx.font = `${11 * devicePixelRatio}px 'Space Mono', monospace`;
      ctx.fillText(
        `${Math.round(amplitude * 100)}`,
        (i * baseWidth) + barWidth / 2, 
        (canvasHeight - barHeight) - 10
      );
    }
  },
};

export default Bars;
