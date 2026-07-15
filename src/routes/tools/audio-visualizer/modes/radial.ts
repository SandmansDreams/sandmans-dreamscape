import type { VisualizerMode } from "../visualizerHelpers";

const Radial: VisualizerMode = {
  id: "radial",
  label: "Radial",
  axisLabels: { vertical: "AMPLITUDE", horizontal: "FREQUENCY (LOW → HIGH)" },
  settings: [
    {
        id: "radialBarCount",
        label: "Bars",
        min: 1,
        max: 1024,
        step: 1, 
        default: 64,
    },
    {
        id: "radialBarWidth",
        label: "Bar Width",
        min: 0.1,
        max: 1.5,
        step: 0.1,
        default: 1,
        format: (v) => `${v}x`,
    },
    {
        id: "radialTilt",
        label: "Tilt",
        min: 0,
        max: 2,
        step: 0.05,
        default: 0.25,
    },
    {
        id: "radialAmpNumbers",
        min: 0,
        max: 1,
        step: 1,
        label: "Amp Numbers",
        default: 1, 
        format: (v) => `${v === 0 ? "OFF" : "ON" }`,
    },
    {
        id: "radialFontSize",
        label: "Font Size",
        min: 1,
        max: 200,
        step: 1,
        default: 14,
        format: (v) => `${v}pt`,
    },
    {
        id: "radialRadius",
        label: "Radius",
        min: 1,
        max: 300,
        step: 1,
        default: 120,
    },
    {
        id: "radialRotation",
        label: "Rotation",
        min: 0,
        max: 360,
        step: 1,
        default: 1, 
        format: (v) => `${v}deg`,
    },
    {
        id: "radialRotationSpeed",
        label: "Spin Speed",
        min: 0.01,
        max: 3,
        step: 0.01,
        default: 1, 
        format: (v) => `${v}x`,
    },
    {
        id: "radialIsRotating",
        label: "Spinning?",
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        format: (v) => `${v === 0 ? "NO" : "YES" }`,
    },
  ],

  draw({ ctx, canvasWidth, canvasHeight, dataArray, bufferLength, values, frameId }) {
    const {
        radialRadius: radius,
        radialRotation: rotation,
        radialBarCount: bars,
        radialBarWidth: widthMult,
        radialTilt: tilt,
        radialAmpNumbers: ampNumbers,
        radialFontSize: fontSize,
        radialIsRotating: isRotating,
        radialRotationSpeed: rotationSpeed,
        hue,
        hueRange,
        ampMult,
        brightness,
    } = values;

    if (frameId === undefined || frameId === null) return // First frame is 0 which is falsy

    const rotationRadians = isRotating
        ? (frameId * rotationSpeed * Math.PI) / 180
        : (rotation * Math.PI) / 180;

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const offset = -Math.PI / 2 + rotationRadians;

    const angleStep = (Math.PI * 2) / bars;
    const step = Math.floor(bufferLength / bars);
    const minLightness = 15;

    for (let i = 0; i < bars; i++) {
        const amplitude = dataArray[i * step] / 255;
        if (amplitude === 0) continue;

        const tiltFactor = (i * tilt * 2) / bars;
        const tiltAmp = amplitude + tiltFactor;

        const innerRadius = radius;

        const safeAmpMult = Number.isFinite(ampMult) ? ampMult : 1;
        const outerRadius = radius + tiltAmp * radius * safeAmpMult;

        const arcWidth = angleStep * widthMult;

        // Centered with gap on either side
        const startAngle = offset + i * angleStep + (angleStep - arcWidth) / 2;
        const endAngle = startAngle + arcWidth;

        const hueAdd = (i * hueRange) / (0.5 * bars);
        const barHue = hue + amplitude * 100 + hueAdd;
        ctx.fillStyle = `hsl(${barHue}, 100%, ${minLightness + amplitude * (brightness - minLightness)}%)`;

        ctx.beginPath();

        ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle); // outer edge

        ctx.lineTo(
        centerX + Math.cos(endAngle) * innerRadius,
        centerY + Math.sin(endAngle) * innerRadius,
        );

        ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true); // inner edge (backwards)

        ctx.closePath();
        ctx.fill();

        if (!ampNumbers) continue;

        const midAngle = (startAngle + endAngle) / 2;
        const textRadius = outerRadius + 12 * devicePixelRatio;
        const textX = centerX + Math.cos(midAngle) * textRadius;
        const textY = centerY + Math.sin(midAngle) * textRadius;

        ctx.font = `${fontSize}px 'Space Mono', monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(amplitude * 100)}`, textX, textY);
    }
  },
};

export default Radial;
