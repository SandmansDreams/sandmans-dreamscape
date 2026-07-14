<script lang="ts">
    import { onMount, onDestroy, getContext, setContext } from "svelte"
    import type { Track, Setting, VisualizerMode } from "./visualizerHelpers"

    const GLOBAL_SETTINGS: Setting[] = [
        {
            id: "hue",
            label: "Hue",
            type: "range",
            min: 0,
            max: 360,
            step: 1,
            default: 140,
        },
        { 
            id: "hueRange",
            label: "Hue Range",
            type: "range",
            min: 1,
            step: 1,
            max: 500,
            default: 1,
        },
        { 
            id: "brightness",
            label: "Brightness",
            type: "range",
            min: 0,
            step: 1,
            max: 200,
            default: 100,
            format: (v) => `${v}%`,
        },
        {
            id: "fade",
            label: "Fade",
            type: "range",
            min: 0,
            step: 0.1,
            max: 100,
            default: 100,
            format: (v) => `${v}%`,
        },
        {
            id: "songSpeed",
            label: "Speed",
            type: "range",
            min: 0.1,
            max: 5,
            step: 0.05,
            default: 1,
            format: (v) => `${v}x`,
        },
        {
            id: "multiplier",
            label: "Multiplier",
            type: "range",
            min: 0.1,
            max: 10,
            step: 0.1,
            default: 1,
            format: (v) => `${v}x`,
        },
    ]

    import Bars from "./modes/bars"

    const MODES = [
        Bars,
    ]

    // Import image assets
    import playIcon from "$lib/images/icons/audio-visualizer/play.svg"
    import pauseIcon from "$lib/images/icons/audio-visualizer/pause.svg"
    import nextIcon from "$lib/images/icons/audio-visualizer/skip-forward.svg"
    import previousIcon from "$lib/images/icons/audio-visualizer/skip-back.svg"
    import volumeIcon from "$lib/images/icons/audio-visualizer/volume.svg"
    import muteIcon from "$lib/images/icons/audio-visualizer/volume-off.svg"
    import shuffleIcon from "$lib/images/icons/audio-visualizer/shuffle.svg"
    import loopIcon from "$lib/images/icons/audio-visualizer/loop.svg"

    // Elements
    let canvasEl: HTMLCanvasElement;
    let ctx2d: CanvasRenderingContext2D | null;
    let rightCanvasAxisEl: HTMLDivElement;
    let topCanvasAxisEl: HTMLDivElement;

    // State
    let audioCtx: AudioContext;
    let audioEl: HTMLAudioElement;
    let analyser: AnalyserNode;
    let sourceNode: MediaElementAudioSourceNode;
    let bufferLength: number;
    let dataArray: Uint8Array<ArrayBuffer>;
    let innerWidth = $state(0);
	let innerHeight = $state(0);

    let frameId: number;
    let modeId = $state(MODES[0]?.id ?? '');
    let currentMode = $derived(MODES.find((m) => m.id === modeId));
    let playing = $state(false);
    let playlist: Track[] = [];
    let myTracks: Track[] = $state([]);
    let currentTrackIndex = $state(0);
    let currentPlaylist = $state(myTracks);

    // merge every mode's settings + globals into one values bag, once, at startup
    let values = $state<Record<string, number>>(
        Object.fromEntries(
            [...GLOBAL_SETTINGS, ...MODES.flatMap((m) => m.settings)].map((s) => [s.id, s.default])
        )
    );

    function setUpAudio() {
        audioCtx = new window.AudioContext();
        audioEl = new Audio();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        audioEl.crossOrigin = 'anonymous';
        sourceNode = audioCtx.createMediaElementSource(audioEl);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength)
    }

    function setUpVisual() {
        ctx2d = canvasEl?.getContext('2d');
        if (canvasEl) {
    
            const dpr = window.devicePixelRatio || 1;
            
            canvasEl.width = dpr * innerWidth;
            canvasEl.height = (dpr * innerHeight) / 2;
        }
    }

    async function importMyTracks() {
        const modules = import.meta.glob(
            '/src/lib/audio/music/*.{mp3,wav}',
            {
                eager: true,
                import: 'default'
            }
        );

        myTracks = Object.entries(modules).map(([path, url]) => {
            const filename = path.split('/').pop() ?? '';

            return {
                name: filename
                    .replace(/\.[^/.]+$/, '')
                    .replace(/[-_]/g, ' '),
                src: url as string,
                length: 0
            };
        });
    }

    function setMode (id: string) {
        modeId = id;
        //currentMode?.onEnter?.();
    }

    function loadTrack(i: number, plist: Track[], autoplay = true) {
        if (i < 0 || i >= plist.length) return;
        currentTrackIndex = i;
        const track = plist[i];
        audioEl.src = track.src;
        audioEl.playbackRate = values.songSpeed;
        if (autoplay) {
            audioCtx?.resume().then(() => audioEl.play());
        }
    }

    function draw(timestamp: number) {
        frameId = requestAnimationFrame(draw);
        if (!ctx2d || !analyser || !dataArray || !currentMode) return;
        //resizeCanvas();
        analyser.getByteFrequencyData(dataArray);

        currentMode.draw({
            ctx: ctx2d,
            canvasWidth: canvasEl?.width,
            canvasHeight: canvasEl?.height,
            dataArray,
            bufferLength,
            timestamp,
            devicePixelRatio,
            values,
        });

    }

    onMount(() => {
        setUpAudio();
        setUpVisual();
        importMyTracks();
        console.log(myTracks)
        frameId = requestAnimationFrame(draw);
    })

    onDestroy(() => {
        //cancelAnimationFrame(frameId);
        audioCtx?.close();
    })
</script>

<svelte:head>
	<title>Audio Visualizer</title>
	<meta name="description" content="A local audio visualizer with settings." />
</svelte:head>

<svelte:window bind:innerWidth bind:innerHeight />

<section>
    <header>
        <h1>SIGNAL</h1>

        <div id="stream-zone" class="click-zone">
            <div class="glyph">◎</div>
            <div class="msg">Stream audio directly from your computer</div>
        </div>

        <div id="player"
            class:playing={playing}
        >
            <div class="track-row">
                <div id="trackName">...</div>
                <div id="trackMeta">—</div>
            </div>
            
            <div class="seek-row">
                <span class="time" id="curTime">0:00</span>
                <input type="range" id="seek" value="0" min="0" max="100" step="0.1">
                <span class="time" id="durTime">0:00</span>
            </div>

            <div class="btn-row">
                <button class="icon-btn" id="prevBtn">
                    <img class="icon" src={previousIcon} alt="skip back"/>
                </button>
                <button class="icon-btn" id="playBtn">
                    <img class="icon" src={playIcon} alt="play"/>
                </button>
                <button class="icon-btn" id="nextBtn">
                    <img class="icon" src={nextIcon} alt="skip forward"/>
                </button>
                <button class="icon-btn toggleable" id="shuffleBtn">
                    <img class="icon" src={shuffleIcon} alt="shuffle"/>
                </button>
                <button class="icon-btn active" id="loopBtn">
                    <img class="icon" src={loopIcon} alt="loop"/>
                </button>
                <button class="icon-btn">
                    <img class="icon" src={volumeIcon} alt="volume">
                </button>
                <input type="range" id="volume" min="0" max="1" step="0.01" value="0.5">
            </div>
        </div>
    </header>

    <div class="viz-wrap">
        {#if currentMode}
            <div class="axis-label axis-right" id="axisRight">Y</div>
            <div class="axis-label axis-top" id="axisTop">X</div>
        {/if}
        <canvas bind:this={canvasEl} id="viz"></canvas>
    </div>

    <div id="selectors">
        <div id="modes">
            {#each MODES as m (m.id)}
                <button class="mode-btn" class:active={modeId === m.id} onclick={() => setMode(m.id)}>
                    {m.label}
                </button>
            {/each} 
        </div>

        <div id="bottom-container">
            <div id="settings-container">
                <div id="settings-all" class="inset-container">
                    <h5>All Settings</h5>
                    {#each GLOBAL_SETTINGS as s (s.id)}
                        <div class="setting">
                            <span class="setting-label">{s.label}</span>
                            <input
                            type="range"
                            min={s.min}
                            max={s.max}
                            step={s.step}
                            bind:value={values[s.id]}
                            />
                            <span class="setting-value">
                                {s.format ? s.format(values[s.id]) : values[s.id]}
                            </span>
                        </div>
                    {/each}
                </div>
                
                <div style="
                    padding-top: .5rem;
                    " id="settings-individual"
                    class="inset-container"
                >
                    <h5>Individual Settings</h5>
                    {#each currentMode?.settings ?? [] as s (s.id)}
                        <div class="setting">
                            <span class="setting-label">{s.label}</span>
                            <input
                                type="range"
                                min={s.min}
                                max={s.max}
                                step={s.step}
                                bind:value={values[s.id]}
                            />
                                <span class="setting-value">
                                    {s.format ? s.format(values[s.id]) : values[s.id]}
                                </span>
                        </div>
                    {/each}
                </div>
            </div>
            
            <div class="inset-container" id="playlist" style="padding: 0;">
                <div id="playlist-selector">
                    <button class="active">My Music</button>
                    <button>Your Music</button>
                </div>

                {#if currentPlaylist === myTracks}
                    {#each myTracks as track, index}
                        <button
                            class="playlist-item"
                            class:playing={index === currentTrackIndex}
                            onclick={() => loadTrack(index, myTracks, true)}
                        >
                            <span>
                                <span class="idx">{(index + 1).toString().padStart(2, '0')}</span>{track.name}
                            </span>
                        </button>
                    {/each}
                {:else if currentPlaylist === playlist && playlist.length === 0}
                    <div id="dropzone">
                        <div class="msg">Drop audio files here, or click to upload</div>
                        <input type="file" id="fileInput" multiple>
                    </div>
                {:else}
                    {#each playlist as track, index}
                        <button
                            class="playlist-item"
                            class:active={index === currentTrackIndex}
                            onclick={() => loadTrack(index, myTracks, true)}
                        >
                            <span>
                                <span class="idx">{(index + 1).toString().padStart(2, '0')}</span>{track.name}
                            </span>
                        </button>
                    {/each}
                {/if}
            </div>
        </div>
    </div>
</section>

<style>

</style>