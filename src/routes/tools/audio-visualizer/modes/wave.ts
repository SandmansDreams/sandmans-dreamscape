import type { VisualizerMode } from "../visualizerHelpers";

// NOTE: this mode reads TIME-DOMAIN data (getByteTimeDomainData), unlike the
// frequency-domain modes below. Expose that to the caller (e.g. a
// `dataType: "timeDomain"` field) if draw() no longer fetches data itself.
const Wave: VisualizerMode = {
    id: "wave",
    label: "Wave",
    dataType: "time",
    axisLabels: { vertical: "AMPLITUDE", horizontal: "TIME" },
    settings: [
        {
            id: "waveLineThickness",
            label: "Thickness",
            min: 0.1,
            max: 50,
            step: 0.1, 
            default: 3,
        },
        {
            id: "waveSliceWidth",
            label: "Resolution",
            min: 1,
            max: 1024,
            step: 1, 
            default: 1024,
        },
        {
            id: "waveGradient",
            label: "Gradient or Solid",
            min: 0,
            max: 1,
            step: 1,
            default: 0,
            format: (v) => `${v === 0 ? "GRADIENT" : "SOLID" }`,
        },
    ],
    draw({ ctx, canvasWidth, canvasHeight, dataArray, bufferLength, values }) {
        const { 
            waveLineThickness: thickness,
            waveSliceWidth: sliceWidth,
            waveGradient: waveGradient,
            hue,
            brightness,
            multiplier,
        } = values;

        const width = canvasWidth / sliceWidth;
        const centerY = canvasHeight / 2;
        const minLightness = 15;
        let x = 0;
        let prevX = 0;
        let prevY = centerY;

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = thickness;

        for (let i = 0; i < bufferLength; i++) {
            const rawDeviation = dataArray[i] / 128.0 - 1;
            const shaped = rawDeviation * multiplier;
            const yPos = centerY + shaped * centerY;
            const clampedY = Math.max(0, Math.min(yPos, canvasHeight));

            if (i > 0) {
                const amplitude = Math.abs(rawDeviation); // 0 = silent, ~1 = loud
                
                if (!waveGradient) {
                    ctx.strokeStyle = `hsl(${hue}, 100%, ${(minLightness * brightness / 100) + amplitude * (brightness - minLightness)}%)`;
                } else {
                    ctx.strokeStyle = `hsl(${hue}, 100%, ${brightness / 2}%`;
                }
                
                ctx.beginPath();
                ctx.moveTo(prevX, prevY);
                ctx.lineTo(x, clampedY);
                ctx.stroke();
            }

            prevX = x;
            prevY = clampedY;
            x += width;
        }
    },
};

export default Wave;
