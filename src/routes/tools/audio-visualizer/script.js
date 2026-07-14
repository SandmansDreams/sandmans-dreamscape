(function () {
/* HTML Element Imports */
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const trackName = document.getElementById("trackName");
const trackMeta = document.getElementById("trackMeta");
const modeBtns = document.querySelectorAll(".mode-btn");

const canvas = document.getElementById("viz");
const ctx2d = canvas.getContext("2d");
const axisRight = document.getElementById("axisRight");
const axisTop = document.getElementById("axisTop");

const playerEl = document.getElementById("player");
const playBtn = document.getElementById("playBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const loopBtn = document.getElementById("loopBtn");

const seek = document.getElementById("seek");
const curTimeEl = document.getElementById("curTime");
const durTimeEl = document.getElementById("durTime");
const volume = document.getElementById("volume");

const playlistEl = document.getElementById("playlist");
const settingsContainer = document.getElementById("settingsContainer");
const settingsAll = document.getElementById("settingsAll");
const settingsIndividual = document.getElementById("settingsIndividual");

  const SETTINGS = [
    {
      id: "hue",
      label: "Hue",
      modes: "all",
      min: 0,
      max: 360,
      step: 1,
      default: 140,
    },
    { 
      id: "hueRange",
      label: "Hue Range",
      modes: "all",
      min: 1,
      step: 1,
      max: 500,
      default: 1,
    },
    { 
      id: "brightness",
      label: "Brightness",
      modes: "all",
      min: 0,
      step: 1,
      max: 200,
      default: 100,
      format: (v) => `${v}%`,
    },
    {
      id: "fade",
      label: "Fade",
      modes: "all",
      min: 0,
      step: 0.1,
      max: 100,
      default: 100,
      format: (v) => `${v}%`,
    },
    {
      id: "songSpeed",
      label: "Speed",
      modes: "all",
      min: 0.1,
      max: 5,
      step: 0.05,
      default: 1,
      format: (v) => `${v}x`,
      onChange: (v) => {
        audio.playbackRate = v;
      },
    },
    {
      id: "multiplier",
      label: "Multiplier",
      modes: "all",
      min: 0.1,
      max: 5,
      step: 0.1,
      default: 1,
      format: (v) => `${v}x`,
    },
    {
      id: "barCount",
      label: "Bars",
      modes: ["bars", "radial"],
      min: 1,
      max: 1024,
      step: 1,
      default: 64,
    },
    {
      id: "barWidth",
      label: "Bar Width",
      modes: ["bars", "radial"],
      min: 0.1,
      max: 1.5,
      step: 0.1,
      default: 1,
      format: (v) => `${v}x`,
    },
    {
      id: "ampNumbers",
      label: "Amp Numbers",
      modes: ["bars", "radial"],
      min: 0,
      max: 1,
      step: 1,
      default: 0, 
      format: (v) => `${v === 0 ? "OFF" : "ON" }`,
    },
    {
      id: "tilt",
      label: "Tilt",
      modes: ["bars", "radial"],
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
    },
    {
      id: "radius",
      label: "Radius",
      modes: ["radial"],
      min: 1,
      max: 300,
      step: 1,
      default: 200,
    },
    {
      id: "rotation",
      label: "Rotation",
      modes: ["radial"],
      min: 0,
      max: 360,
      step: 1,
      default: 1, 
      format: (v) => `${v}deg`,
    },
    {
      id: "isRotating",
      label: "Spinning?",
      modes: ["radial"],
      min: 0,
      max: 1,
      step: 1,
      default: 0, 
      format: (v) => `${v === 0 ? "NO" : "YES" }`,
    },
    {
      id: "rotationSpeed",
      label: "Spin Speed",
      modes: ["radial"],
      min: 0.01,
      max: 3,
      step: 0.01,
      default: 1, 
      format: (v) => `${v}x`,
    },
  ];

  class SettingsManager {
    // Controls and establishes settings
    constructor(defs) {
      this.values = {};
      this.rowsByMode = {};
      const saved = this._load();
      defs.forEach((def) => this._register(def, def.modes === "all" ? settingsAll : settingsIndividual, saved));
    }

    _register(def, container, saved) {
      // Attempt to load saved values
      const initial = (saved && saved[def.id] !== undefined) ? saved[def.id] : def.default;
      this.values[def.id] = def.default;
      const format = def.format || ((v) => `${v}`); // Default formatting function or provided format

      const row = document.createElement("div");
      row.className = "submodes";
      row.innerHTML = `
            <span class="submode-label">${def.label}</span>
            <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${def.default}">
            <span class="submode-value">${format(def.default)}</span>
        `;

      container.appendChild(row);

      // Add input event listener
      const input = row.querySelector("input");
      const valueEl = row.querySelector(".submode-value");
      input.addEventListener("input", () => {
        const val = Number.isInteger(def.step)
          ? parseInt(input.value)
          : parseFloat(input.value); // Get the value as a float or int
        this.values[def.id] = val; // Set the value
        valueEl.textContent = format(val); // Set the text value
        def.onChange?.(val);
        this._save();
      });

      // Double-click reset
      input.addEventListener("dblclick", () => {
        this.values[def.id] = def.default;
        input.value = def.default;
        valueEl.textContent = def.default;
        this._save();
      })

      const modes = def.modes === "all" ? MODES : def.modes;
      modes.forEach((m) => (this.rowsByMode[m] ??= []).push(row));
    }

    showForMode(mode) {
      Object.values(this.rowsByMode)
        .flat()
        .forEach((r) => r.classList.remove("visible"));
      (this.rowsByMode[mode] || []).forEach((r) => r.classList.add("visible"));
    }

    get(id) {
      return this.values[id];
    }

    _save() {
      try {
        localStorage.setItem('signal-settings', JSON.stringify(this.values));
      } catch(e) {
        console.warn('Could not save settings:', e);
      }
    }

    _load() {
      try {
        const saved = localStorage.getItem('signal-settings');
        return saved ? JSON.parse(saved) : null;
      } catch(e) {
        return null;  
      }
    }
  }

  const MODES = ["bars", "wave", "radial", "mirror", "spectrogram"];

  const AXIS_LABELS = {
    bars: { left: "AMPLITUDE", bottom: "FREQUENCY (LOW → HIGH)" },
    wave: { left: "AMPLITUDE", bottom: "TIME →" },
    radial: {
      left: "MAGNITUDE (RADIUS)",
      bottom: "FREQUENCY (ANGLE, LOW → HIGH)",
    },
    mirror: { left: "AMPLITUDE (MIRRORED)", bottom: "FREQUENCY (LOW → HIGH)" },
    spectrogram: { left: "FREQUENCY (LOW ↓ HIGH ↑)", bottom: "TIME →" },
  };

  const settings = new SettingsManager(SETTINGS);
  let audioCtx, analyser, sourceNode, dataArray, bufferLength;
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  let canvasWidth = canvas.width; 
  let canvasHeight = canvas.height;

  let playlist = []; // {file, url, name}
  let shuffleOrder = [];
  let currentIndex = -1;
  let shufflePosition = -1;
  let mode = "";
  let rafId = null;
  let spectrogramBuf = null; // offscreen canvas for scrolling spectrogram
  let isPlaying = false;
  let isShuffling = false; 
  let isLooping = true;

  function formatTime(s) {
    if (!isFinite(s)) return "0:00";

    const minutes = Math.floor(s / 60);
    const seconds = Math.floor(s % 60) // s is not in whole integers
      .toString()
      .padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * devicePixelRatio);
    const h = Math.round(rect.height * devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvasWidth = w;
      canvasHeight = h;
      spectrogramBuf = null; // reset scroll buffer on resize
    }
  }
  window.addEventListener("resize", resizeCanvas);

  function setupAudioGraph() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  function addFiles(fileList) {
    const files = Array.from(fileList).filter(
      (f) =>
        ( // Filters to only audio files
          f.type.startsWith("audio/") ||
          /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name)
        ) && 
        !playlist.some(track => track.name === f.name) // Filters out files already added to playlist
    );

    if (files.length === 0) return;

    files.forEach((f) => {
      playlist.push({ file: f, url: URL.createObjectURL(f), name: f.name });
    });
    buildShuffleOrder();
    renderPlaylist();
    if (currentIndex === -1) loadTrack(0);
  }

  function renderPlaylist() {
    playlistEl.innerHTML = "";
    playlist.forEach((t, i) => {
      const div = document.createElement("div");
      div.className = "playlist-item" + (i === currentIndex ? " playing" : "");
      div.innerHTML = `<span><span class="idx">${(i + 1).toString().padStart(2, "0")}</span>${t.name}</span>`;
      div.addEventListener("click", () => loadTrack(i, true));
      playlistEl.appendChild(div);
    });
  }

  function loadTrack(i, autoplay) {
    if (i < 0 || i >= playlist.length) return;

    currentIndex = i;
    const track = playlist[i];
    audio.src = track.url;
    audio.playbackRate = settings.get("songSpeed");
    trackName.textContent = track.name;
    trackMeta.textContent = "—";
    renderPlaylist();
    setupAudioGraph();
    if (autoplay === undefined) autoplay = true;
    if (autoplay) {
      audioCtx.resume().then(() => {
        audio.play();
      });
    }
  }

  function shuffleArray(array) {
    const shuffled = [...array]; 

    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; // Swap elements
    }
    return shuffled;
  }

  function buildShuffleOrder() {
    const indicies = playlist.map((_, i) => i);
    shuffleOrder = shuffleArray(indicies);
    shufflePosition = shuffleOrder.indexOf(currentIndex);
  }

  function readEntry(entry){
    return new Promise((resolve) => {
      if(entry.isFile){
        entry.file((file) => resolve([file]), () => resolve([]));
      } else if(entry.isDirectory){
        const reader = entry.createReader();
        const allEntries = [];
        const readBatch = () => {
          reader.readEntries(async (entries) => {
            if(entries.length === 0){
              const nested = await Promise.all(allEntries.map(readEntry));
              resolve(nested.flat());
            } else {
              allEntries.push(...entries);
              readBatch();
            }
          }, () => resolve([]));
        };
        readBatch();
      } else {
        resolve([]);
      }
    });
  }

  async function handleDrop(e){
    const items = e.dataTransfer.items;
    if(items && items.length && items[0].webkitGetAsEntry){
      const entries = Array.from(items).map(item => item.webkitGetAsEntry()).filter(Boolean);
      const nestedFiles = await Promise.all(entries.map(readEntry));
      addFiles(nestedFiles.flat());
    } else {
      addFiles(e.dataTransfer.files); // fallback for older browsers
    }
  }

  audio.addEventListener("loadedmetadata", () => {
    durTimeEl.textContent = formatTime(audio.duration);
    seek.max = audio.duration;
    trackMeta.textContent = formatTime(audio.duration) + " TOTAL";
  });

  audio.addEventListener("timeupdate", () => {
    if (!seek.matches(":active")) {
      seek.value = audio.currentTime;
    }
    curTimeEl.textContent = formatTime(audio.currentTime);
  });

  audio.addEventListener("play", () => {
    isPlaying = true;
    playBtn.textContent = "❚❚";
    draw();
  });
  audio.addEventListener("pause", () => {
    isPlaying = false;
    playBtn.textContent = "▶";
    cancelAnimationFrame(rafId);
  });
  audio.addEventListener("ended", () => {
    const playlistLength = playlist.length;
    const nextIndex = currentIndex + 1;

    if (isLooping) {
      loadTrack(currentIndex, true);
      return;
    }
    if (isShuffling && playlistLength > 1) {
      shufflePosition++;
      if (shufflePosition < shuffleOrder.length) {
        loadTrack(shuffleOrder[shufflePosition], true);
      } else {
        playBtn.textContent = "▶"; // reached end of shuffled queue
      }
      return;
    }
    if (nextIndex < playlistLength) {
      loadTrack(nextIndex, true);
    } else {
      playBtn.textContent = "▶"; // reached end of playlist
    }
  });

  playBtn.addEventListener("click", () => {
    if (currentIndex === -1) return;
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

    if (!isPlaying) {
      audio.play();
    } else {
      audio.pause();
    }
  });
  prevBtn.addEventListener("click", () =>
    loadTrack(Math.max(0, currentIndex - 1), true),
  );
  nextBtn.addEventListener("click", () =>
    loadTrack(Math.min(playlist.length - 1, currentIndex + 1), true),
  );

  shuffleBtn.addEventListener("click", () => {
    isShuffling = !isShuffling;
    shuffleBtn.classList.toggle("active", isShuffling);
    if (isShuffling) buildShuffleOrder();
  });
  loopBtn.addEventListener("click", () => {
    isLooping = !isLooping;
    loopBtn.classList.toggle("active", isLooping);
  });

  seek.addEventListener("input", () => {
    audio.currentTime = seek.value;
  });
  volume.addEventListener("input", () => {
    audio.volume = volume.value;
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.mode)
      fillCanvas(100);
    });
  });

  function setMode(m) {
    mode = m; // Update outer mode
    modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === m)); // Set active mode button to active state
    settings.showForMode(m); // Show the proper settings

    // Set up proper axis labels
    const labels = AXIS_LABELS[m];
    if (labels) {
      axisRight.textContent = labels.left;
      axisTop.textContent = labels.bottom;
    }
  }

  // Drag & drop
  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("drag");
    });
  });
  dropzone.addEventListener('drop', handleDrop);
  window.addEventListener('drop', (e) => {
    if(e.target === dropzone || dropzone.contains(e.target)) return;
    e.preventDefault();
    handleDrop(e);
  });
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => addFiles(fileInput.files));

  function freqToColor(v) {
    // v is 0-1 intensity -> dark background through green/amber hot map
    const hue = 150 - v * 150; // 150 (green) down to 0 (red) as intensity rises
    const light = 6 + v * 55;
    const sat = 85;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  function fillCanvas(fade) {
      ctx2d.fillStyle = `rgba(13, 16, 18, ${fade/100})`;
      ctx2d.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  function draw() {
    rafId = requestAnimationFrame(draw);
    resizeCanvas();

    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const hue = settings.get("hue");
    const hueRange = settings.get("hueRange");
    const brightness = settings.get("brightness");
    const ampMult = settings.get("multiplier");
    const numbers = settings.get("ampNumbers");

    const darkBackground = `rgba(13, 16, 18, 100)`;
    const fade = settings.get("fade");

    if (mode === "bars") {
      const bars = settings.get("barCount");
      const widthMult = settings.get("barWidth");
      const tilt = settings.get("tilt");
      //const logScale = settings.get("logScale");

      fillCanvas(fade);

      analyser.getByteFrequencyData(dataArray);
      const baseWidth = canvasWidth / bars;
      const barWidth = baseWidth * widthMult;
      const step = Math.floor(bufferLength / bars);
      
      for (let i = 0; i < bars; i++) {
        const amplitude = dataArray[i * step] / 255;
        if (amplitude === 0) continue;

        const tiltFactor = (i * tilt) / bars;
        const tiltAmp = amplitude + tiltFactor;
        let barHeight = tiltAmp * canvasHeight * ampMult;
        const hueAdd = (i * hueRange) / (.5 * bars);
        const barHue = hue + (amplitude * 100) + hueAdd;

        ctx2d.fillStyle = `hsl(${barHue}, 100%, ${Math.max(15, amplitude * brightness)}%)`;
        ctx2d.fillRect(
          i * baseWidth, // x pos: i * baseWidth 
          canvasHeight - barHeight, // At bottom of canvas
          barWidth,
          barHeight,
        );

        if (!numbers) continue;

        ctx2d.font = `${11 * devicePixelRatio}px 'Space Mono', monospace`;
        ctx2d.fillText(
          `${Math.round(amplitude * 100)}`,
          (i * baseWidth) + barWidth / 2, 
          (canvasHeight - barHeight) - 10
        );
      }
    } else if (mode === "wave") {
      fillCanvas(fade);

      analyser.getByteTimeDomainData(dataArray);
      ctx2d.lineWidth = 5 * devicePixelRatio;
      ctx2d.strokeStyle = `hsl(${hue}, 100%, 50%)`;
      ctx2d.beginPath();
      const sliceWidth = canvasWidth / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvasHeight) / 2;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
        x += sliceWidth;
      }
      ctx2d.stroke();
    } else if (mode === "radial") {
      const radius = settings.get("radius");
      const rotation = settings.get("rotation");
      const bars = settings.get("barCount");
      const widthMult = settings.get("barWidth");
      const tilt = settings.get("tilt");
      const numbers = settings.get("ampNumbers");

      fillCanvas(fade);
      
      const isRotating = settings.get("isRotating");
      const rotationSpeed = settings.get("rotationSpeed");
      const rotationRadians = isRotating 
        ? rafId * rotationSpeed * Math.PI / 180 
        : rotation * Math.PI / 180;

      analyser.getByteFrequencyData(dataArray);
      const centerX = canvasWidth / 2;
      const centerY = canvasHeight / 2;
      const offset = (-Math.PI / 2) + rotationRadians;
      
      const angleStep = (Math.PI * 2) / bars; // In radians
      const step = Math.floor(bufferLength / bars)
      
      for (let i = 0; i < bars; i++) {
        const amplitude = dataArray[i*step] / 255;
        if (amplitude === 0) continue;

        const tiltFactor = (i * tilt * 2) / bars;
        const tiltAmp = amplitude + tiltFactor;

        const innerRadius = radius;
        const outerRadius = radius + (tiltAmp * radius * ampMult);
        const arcWidth = angleStep * widthMult;

        // Centered with gap on either side
        const startAngle = offset + i * angleStep + (angleStep - arcWidth) / 2;
        const endAngle = startAngle + arcWidth;

        const hueAdd = (i * hueRange) / (.5 * bars);
        const barHue = hue + (amplitude * 100) + hueAdd;
        ctx2d.fillStyle = `hsl(${barHue}, 100%, ${Math.max(15, amplitude * brightness)}%)`;

        ctx2d.beginPath();

        ctx2d.arc( // Outer edge
          centerX,
          centerY,
          outerRadius,
          startAngle,
          endAngle,
        );

        ctx2d.lineTo(
          centerX + Math.cos(endAngle) * innerRadius,
          centerY + Math.sin(endAngle) * innerRadius
        );

        ctx2d.arc( // inner edge (draw backwards)
          centerX,
          centerY,
          innerRadius,
          endAngle,
          startAngle,
          true
        );

        ctx2d.closePath();
        ctx2d.fill();

        if (!numbers) continue;
        
        const midAngle = (startAngle + endAngle) / 2;
        const textRadius = outerRadius + 12 * devicePixelRatio;
        const textX = centerX + Math.cos(midAngle) * textRadius;
        const textY = centerY + Math.sin(midAngle) * textRadius;

        ctx2d.font = `${11 * devicePixelRatio}px 'Space Mono', monospace`;
        ctx2d.fillText(`${Math.round(amplitude * 100)}`, textX, textY);
      }
    } else if (mode === "mirror") {
      fillCanvas(fade);
      analyser.getByteFrequencyData(dataArray);
      const barCount = 96;
      const step = Math.floor(bufferLength / barCount);
      const barWidth = canvasWidth / barCount;
      const midY = canvasHeight / 2;
      for (let i = 0; i < barCount; i++) {
        const v = dataArray[i * step] / 255;
        const barH = v * (canvasHeight / 2) * 0.9;
        ctx2d.fillStyle = `hsla(160, 90%, ${45 + v * 25}%, 0.9)`;
        ctx2d.fillRect(i * barWidth + 1, midY - barH, barWidth - 2, barH * 2);
      }
      ctx2d.strokeStyle = "rgba(107,255,158,0.3)";
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, midY);
      ctx2d.lineTo(canvasWidth, midY);
      ctx2d.stroke();
    } else if (mode === "spectrogram") {
      analyser.getByteFrequencyData(dataArray);

      if (
        !spectrogramBuf ||
        spectrogramBuf.width !== canvasWidth ||
        spectrogramBuf.height !== canvasHeight
      ) {
        spectrogramBuf = document.createElement("canvas");
        spectrogramBuf.width = canvasWidth;
        spectrogramBuf.height = canvasHeight;
        const bctx = spectrogramBuf.getContext("2d");
        bctx.fillStyle = darkBackground;
        bctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }
      const bctx = spectrogramBuf.getContext("2d");

      // shift existing image left by 2px
      const shift = 2;
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
      bctx.fillStyle = darkBackground;
      bctx.fillRect(canvasWidth - shift, 0, shift, canvasHeight);

      // draw new column(s) at the right edge, low freq at bottom, high freq at top
      const bins = bufferLength;
      for (let y = 0; y < canvasHeight; y++) {
        // map canvas row to a frequency bin (log-ish weighting toward lower freqs)
        const t = 1 - y / canvasHeight;
        const binIndex = Math.min(
          bins - 1,
          Math.floor(Math.pow(t, 1.8) * bins),
        );
        const v = dataArray[binIndex] / 255;
        bctx.fillStyle = freqToColor(v);
        bctx.fillRect(canvasWidth - shift, y, shift, 1);
      }

      ctx2d.drawImage(spectrogramBuf, 0, 0);
      ctx2d.fillStyle = "rgba(255,255,255,0.55)";
      ctx2d.font = `${11 * devicePixelRatio}px 'Space Mono', monospace`;
      ctx2d.fillText("HIGH", 6 * devicePixelRatio, 14 * devicePixelRatio);
      ctx2d.fillText(
        "LOW",
        6 * devicePixelRatio,
        canvasHeight - 8 * devicePixelRatio,
      );
    }
  }

  setMode("bars");
  resizeCanvas();
})();
