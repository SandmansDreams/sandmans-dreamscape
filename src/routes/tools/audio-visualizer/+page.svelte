<script lang="ts">
    /* ToDo:
        - Settings storage
        - Implement rest of modes
        - More effects: pitch? reverb?
        - Stream from computer audio
        - Center quote text on Firefox (main page)
        - ARTICLES DON'T WORK?! cant acces property getContent is null
    */
    import { onMount, onDestroy } from "svelte"
    import { browser } from "$app/environment"
    import { type Track, type Setting, type Playlist } from "./visualizerHelpers"

    const STORAGE_KEY = 'visualizer-settings';

    class AudioPlayer {
        readonly audioEl = new Audio();
        readonly context = new AudioContext();
        readonly analyzer = this.context.createAnalyser();
        readonly gain = this.context.createGain();
        readonly source = this.context.createMediaElementSource(this.audioEl);
        readonly bufferLength: number;
        readonly frequencyArray: Uint8Array<ArrayBuffer>;
        readonly timeArray: Uint8Array<ArrayBuffer>

        private playOrder = $state<number[]>([]);
        private orderPosition = $state(0)
        private playlists: Playlist[] = $state([]);
        currentTrack = $state<Track | null>(null);
        currentPlaylist = $state<Playlist | null>(null);
        currentTrackIndex = $state(0);

        time: number = $state(0);
        duration: number = $state(0);
        isPlaying = $state(false);
        isLooping = $state(true);
        isMuted = $state(false);
        isShuffling = $state(false);



        constructor() {
            // Prepares the audio
            this.analyzer.fftSize = 2048;
            this.audioEl.crossOrigin = 'anonymous';
            this.source.connect(this.analyzer);
            this.analyzer.connect(this.gain);
            this.gain.connect(this.context.destination);

            this.bufferLength = this.analyzer.frequencyBinCount;
            this.frequencyArray = new Uint8Array(this.bufferLength);
            this.timeArray = new Uint8Array(this.bufferLength);

            // Event Listeners
            this.audioEl.onloadedmetadata = () => {
                this.duration = this.audioEl.duration;
            };

            this.audioEl.ontimeupdate = () => {
                this.time = this.audioEl.currentTime;
            };

            this.audioEl.onplay = () => {
                this.isPlaying = true;
            };

            this.audioEl.onpause = () => {
                this.isPlaying = false;
            };

            this.audioEl.onended = () => {
                if (this.isLooping) {
                    this.play();
                } else {
                    this.skip();
                    this.play();
                }
            }
        }

        updateData() {
            this.analyzer.getByteFrequencyData(this.frequencyArray);
            this.analyzer.getByteTimeDomainData(this.timeArray);
        }

        addPlaylist(playlist: Playlist) {
            if (this.getPlaylist(playlist.id)) return; // If a playlist by that name exists, ignore

            this.playlists.push(playlist);

            if (!this.currentPlaylist) {
                this.currentPlaylist = playlist;
                this.buildPlayOrder();
            }
        }

        addTrackToPlaylist (track: Track, playlistId: string) {
            const playlist = this.getPlaylist(playlistId);
            if (!playlist) return;

            playlist.tracks.push(track);

            if (this.currentPlaylist?.id === playlistId) {
                this.buildPlayOrder();
            }
        }

        getPlaylist(playlistId: string) {
            return this.playlists.find(p => p.id === playlistId) || null
        }

        getTrack(trackId: number) {
            return this.currentPlaylist?.tracks[trackId]
        }

        async loadTrack(trackIndex: number, autoplay = false) {
            if (!this.currentPlaylist) return
            if (trackIndex < 0 || trackIndex >= this.currentPlaylist.tracks.length) return;

            this.currentTrackIndex = trackIndex;
            const speed = this.audioEl.playbackRate

            const position = this.playOrder.indexOf(trackIndex);
            if (position >= 0) this.orderPosition = position;

            const track = this.currentPlaylist.tracks[trackIndex];
            this.currentTrack = track;
            this.audioEl.src = track.src;
            this.duration = this.audioEl.duration;
            this.audioEl.playbackRate = speed

            if (autoplay) {
                this.play();
            } else {
                if (this.isPlaying) this.play();
                else this.pause();
            }
        }

        togglePlay() {
            if (this.isPlaying) {
                this.pause()
            } else {
                this.play()
            }
        }
        
        toggleShuffle() { 
            this.isShuffling = !this.isShuffling
            this.buildPlayOrder();
        }   
        
        toggleMute() { 
            this.isMuted = !this.isMuted

            if (this.isMuted) {
                this.gain.gain.value = 0
            } else {
                this.gain.gain.value = 1
            }
        }

        toggleLoop() { this.isLooping = !this.isLooping }


        play() {
            this.context.resume().then(() => this.audioEl.play()); // Try to resume, otherwise play from beginning
        }

        pause() { this.audioEl.pause(); }

        seek(time: number) {
            this.audioEl.currentTime = time;
        }

        skip(directionKey?: string) {
            if (this.playOrder.length === 0) return

            if (directionKey === "back") {
                this.orderPosition = (this.orderPosition - 1 + this.playOrder.length) % this.playOrder.length;
                this.loadTrack(this.playOrder[this.orderPosition], false);
            } else {
                this.orderPosition = (this.orderPosition + 1) % this.playOrder.length
                this.loadTrack(this.playOrder[this.orderPosition], false)
            }
        }

        setVolume(volume: number) { this.gain.gain.value = volume }

        setPlaylist(playlistId: string) {
            if (this.currentPlaylist?.id === playlistId) return

            this.currentPlaylist = this.getPlaylist(playlistId)
            this.buildPlayOrder()
        }

        setRate(rateMult: number) { this.audioEl.playbackRate = rateMult }

        setPreservePitch(bool: boolean) { this.audioEl.preservesPitch = bool }

        setPitch() {} // Is implementable?

        setFormant() {} // Is implementable?

        destroy() {
            this.getPlaylist("uploadedTracks")?.tracks.forEach(t => URL.revokeObjectURL(t.src));
            this.source.disconnect();
            this.analyzer.disconnect();
            this.context.close();
        }

        private buildPlayOrder() {
            if (!this.currentPlaylist) {
                this.playOrder = [];
                return;
            }

            const indices = this.currentPlaylist.tracks.map((_, i) => i);
            
            if (this.isShuffling) {
                // Fisher-Yates Shuffle
                for (let i = indices.length - 1; i > 0; i--) {
                    let j = Math.floor(Math.random() * (i + 1));
                    [indices[i], indices[j]] = [indices[j], indices[i]];
                }
            }

            this.playOrder = indices;

            const position = this.playOrder.indexOf(this.currentTrackIndex);
            this.orderPosition = position >= 0 ? position : 0;
        }
    }

    const GLOBAL_SETTINGS: Setting[] = [
        {
            id: "hue",
            label: "Hue",
            min: 0,
            max: 360,
            step: 1,
            default: 140,
        },
        { 
            id: "hueRange",
            label: "Hue Range",
            min: 1,
            step: 1,
            max: 500,
            default: 1,
        },
        { 
            id: "brightness",
            label: "Brightness",
            min: 0,
            step: 1,
            max: 200,
            default: 100,
            format: (v) => `${v}%`,
        },
        {
            id: "fade",
            label: "Fade",
            min: 0,
            step: 0.1,
            max: 100,
            default: 100,
            format: (v) => `${v}%`,
        },
        {
            id: "songSpeed",
            label: "Speed",
            min: 0.1,
            max: 5,
            step: 0.05,
            default: 1,
            format: (v) => `${v}x`,
        },
        {
            id: "preservePitch",
            label: "Preserve Pitch",
            min: 0,
            max: 1,
            step: 1,
            default: 1,
            format: (v) => `${v === 0 ? "OFF" : "ON" }`,
        },
        {
            id: "multiplier",
            label: "Multiplier",
            min: 0.1,
            max: 10,
            step: 0.1,
            default: 1,
            format: (v) => `${v}x`,
        },
    ]

    import Bars from "./modes/bars"
    import Radial from "./modes/radial"
    import Wave from "./modes/wave"

    import Spectrogram from "./modes/spectrogram"

    const MODES = [
        Bars,
        Radial,
        Wave,
        Spectrogram,
    ]

    // Import image assets
    import playIcon from "$lib/images/icons/audio-visualizer/play.svg"
    import pauseIcon from "$lib/images/icons/audio-visualizer/pause.svg"
    import nextIcon from "$lib/images/icons/audio-visualizer/skip-forward.svg"
    import previousIcon from "$lib/images/icons/audio-visualizer/skip-back.svg"
    import volumeIcon from "$lib/images/icons/audio-visualizer/volume.svg"
    import muteIcon from "$lib/images/icons/audio-visualizer/volume-off.svg"
    import shuffleIcon from "$lib/images/icons/audio-visualizer/shuffle.svg"
    import loopIcon from "$lib/images/icons/audio-visualizer/loop.svg";

    // Elements
    let canvasEl = $state<HTMLCanvasElement | null>(null);
    let ctx2d = $state<CanvasRenderingContext2D | null>(null);

    // State
    let player = $state<AudioPlayer | null>(null);
    let innerWidth = $state(0);
	let innerHeight = $state(0);

    let frameId: number;
    let modeId = $state(MODES[0]?.id ?? '');
    let currentMode = $derived(MODES.find((m) => m.id === modeId));

    let isDraggingOverPage = $state(false);
    let dragCounter = 0;

     // merge every mode's settings + globals into one values bag, once, at startup
    const defaultValues = Object.fromEntries(
        [...GLOBAL_SETTINGS, ...MODES.flatMap((m) => m.settings)].map((s) => [s.id, s.default])
    );

    let values = $state<Record<string, number>>(loadStoredValues(defaultValues));
    let saveTimeout: ReturnType<typeof setTimeout>;

    function loadStoredValues(defaults: Record<string, number>): Record<string, number> {
        if (!browser) return defaults

        try {
            const raw = localStorage.getItem(STORAGE_KEY)
            if (!raw) return defaults

            const stored = JSON.parse(raw)

            // Restore settings and merge with any new added settings
            return {...defaults, ...stored}
        } catch {
            return defaults;
        }
    }

    function formatTime(duration: number) {
        if (!isFinite(duration)) return "0:00";

        const minutes = Math.floor(duration / 60);
        const seconds = Math.floor(duration % 60) // duration is not in whole integers

        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    async function importMyTracks() {
        if (!player) return

        const modules = import.meta.glob(
            '/src/lib/audio/music/*.{mp3,wav}',
            {
                eager: true,
                import: 'default'
            }
        );

        const myTracks = Object.entries(modules).map(([path, url]) => {
            const filename = path.split('/').pop() ?? '';

            return {
                name: filename
                    .replace(/\.[^/.]+$/, '')
                    .replace(/[-_]/g, ' '),
                src: url as string,
            };
        });

        player.addPlaylist({
            id: "myTracks",
            name: "My Tracks",
            tracks: myTracks
        })

        player.setPlaylist("myTracks");
        player.loadTrack(0, false)
    }

    function setMode (id: string) {
        modeId = id;
        //currentMode?.onEnter?.();
    }

    function draw(timestamp: number) {
        frameId = requestAnimationFrame(draw);
        if (!player || !currentMode || !canvasEl || !ctx2d) return;

        // Required
        player.updateData();

        fillCanvas(values["fade"]);

        const rect = canvasEl.getBoundingClientRect();
        const dataArray = currentMode.dataType === "time"
            ? player.timeArray
            : player.frequencyArray

        currentMode.draw({
            ctx: ctx2d!,
            canvasWidth: rect.width,
            canvasHeight: rect.height,
            dataArray: dataArray,
            bufferLength: player.bufferLength,
            timestamp,
            devicePixelRatio,
            values,
            frameId
        });
    }

    function fillCanvas(fade: number) {
        if (!ctx2d || !canvasEl) return;
        
        ctx2d.fillStyle = `rgba(13, 16, 18, ${fade/100})`;
        ctx2d.fillRect(0, 0, canvasEl.width, canvasEl.height);
    }

    function resizeCanvas() {
        if (!canvasEl || !ctx2d) return;

        const rect = canvasEl.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Resize the backing buffer to match the displayed size
        canvasEl.width = Math.round(rect.width * dpr);
        canvasEl.height = Math.round(rect.height * dpr);

        // Reset any previous transforms and scale for HiDPI displays
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Optional: disable image smoothing for crisp pixel rendering
        // ctx2d.imageSmoothingEnabled = false;
    }

    function handleFiles(files: FileList | File[]) {
        if (!player) return;

        const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/')); // Only accepts audio tracks
        if (audioFiles.length === 0) return;

        const playlist = player.getPlaylist("uploadedTracks");
        const startIndex = playlist?.tracks.length ?? 0;

        for (const file of audioFiles) {
            if (playlist?.tracks.find((t) => t.name === file.name)) continue;

            const track: Track = {
                name: file.name,
                src: URL.createObjectURL(file),
            };

            player.addTrackToPlaylist(track, "uploadedTracks");
        }

        player.setPlaylist("uploadedTracks");
        //player.loadTrack(startIndex, false); // load first newly-added track, don't autoplay
    }

    function onFileInputChange(e: Event) {
        const input = e.target as HTMLInputElement;
        if (input.files) handleFiles(input.files);
        input.value = ''; // allows re-selecting the same file later
    }

    function onWindowDragEnter(e: DragEvent) {
        e.preventDefault();
        // ignore drags that aren't carrying files (e.g. dragging page text/links around)
        if (!e.dataTransfer?.types.includes('Files')) return;

        dragCounter++;
        isDraggingOverPage = true;
    }

    function onWindowDragOver(e: DragEvent) {
        e.preventDefault(); // required continuously, or the browser opens the file
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }

    function onWindowDragLeave(e: DragEvent) {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            isDraggingOverPage = false;
        }
    }

    function onWindowDrop(e: DragEvent) {
        e.preventDefault();
        dragCounter = 0;
        isDraggingOverPage = false;
        if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    }

    onMount(() => {    
        player = new AudioPlayer();
        importMyTracks(); // Calls loadTrack(0)

        player.addPlaylist({
            id: "uploadedTracks",
            name: "Uploaded Tracks",
            tracks: []
        })

        frameId = requestAnimationFrame(draw);

        addEventListener("keydown", (e) => {
            if (e.key === " ") {
                e.preventDefault()
                player?.togglePlay()
            }
        })

        window.addEventListener('dragenter', onWindowDragEnter);
        window.addEventListener('dragover', onWindowDragOver);
        window.addEventListener('dragleave', onWindowDragLeave);
        window.addEventListener('drop', onWindowDrop);

        return () => {
            window.removeEventListener('dragenter', onWindowDragEnter);
            window.removeEventListener('dragover', onWindowDragOver);
            window.removeEventListener('dragleave', onWindowDragLeave);
            window.removeEventListener('drop', onWindowDrop);
        };
    })

    $effect(() => {
        const snapshot = JSON.stringify(values); // establishes the reactive dependency
        if (!browser) return;

        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            localStorage.setItem(STORAGE_KEY, snapshot);
        }, 300);
    })

    $effect(() => {
        if (!canvasEl) return;

        innerWidth;
        innerHeight;

        ctx2d = canvasEl.getContext("2d");
        resizeCanvas();
    })

    $effect(() => {
        if (!player) return;
        player.setRate(values["songSpeed"])
        player.setPreservePitch(Boolean(values["preservePitch"]))
    })

    onDestroy(() => {
        //cancelAnimationFrame(frameId);
        player?.destroy();
    })
</script>

<svelte:head>
	<title>Audio Visualizer</title>
	<meta name="description" content="A local audio visualizer with settings." />
</svelte:head>

<svelte:window bind:innerWidth bind:innerHeight />

<section>
    {#if player}
        <header>
            <h1>VISUALIZE</h1>

            <!-- <div id="stream-zone" class="click-zone">
                <div class="glyph">◎</div>
                <div class="msg">Stream audio directly from your computer (coming soon???)</div>
            </div> -->
            <div></div>
            
            <div id="player"
                class:playing={player.isPlaying}
            >
                <div class="track-row">
                    <div id="trackName">{`${player?.currentTrackIndex + 1}: ${player?.currentTrack?.name ?? "..."}`}</div>

                </div>
                
                <div class="seek-row">
                    <span class="time" id="curTime">{formatTime(player.time)}</span>
                    <input type="range" id="seek" bind:value={player.time} min="0" max={player.duration || 100} step="0.1" oninput={() => player?.seek(player.time)}>
                    <span class="time" id="durTime">{formatTime(player.duration) ?? "-"}</span>
                </div>

                <div class="btn-row">
                    <button class="icon-btn" id="prevBtn" onclick={() => player?.skip("back")}>
                        <img class="icon" src={previousIcon} alt="skip back"/>
                    </button>
                <button class="icon-btn {player.isPlaying ? "active" : ""}" id="playBtn" onclick={() => player?.togglePlay()}>
                        <img class="icon" src={player.isPlaying ? pauseIcon : playIcon} alt="play"/>
                    </button>
                    <button class="icon-btn" id="nextBtn" onclick={() => player?.skip()}>
                        <img class="icon" src={nextIcon} alt="skip forward"/>
                    </button>
                    <button class="icon-btn {player.isShuffling ? "active" : ""}" id="shuffleBtn" onclick={() => player?.toggleShuffle()}>
                        <img class="icon" src={shuffleIcon} alt="shuffle"/>
                    </button>
                    <button class="icon-btn {player.isLooping ? "active" : ""}" id="loopBtn" onclick={() => player?.toggleLoop()}>
                        <img class="icon" src={loopIcon} alt="loop"/>
                    </button>
                    <button class="icon-btn" onclick={() => player?.toggleMute()}>
                        <img class="icon" src={player.isMuted ? muteIcon : volumeIcon} alt="volume">
                    </button>
                    <input type="range" id="volume" min="0" max="1" step="0.01" bind:value={player.gain.gain.value}>
                </div>
            </div>
        </header>

        <div class="viz-wrap">
            {#if currentMode}
                <div class="axis-label axis-left" id="axisLeft">{currentMode?.axisLabels.vertical}</div>
                <div class="axis-label axis-top" id="axisTop">{currentMode?.axisLabels.horizontal}</div>
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
                        <h5 class="axis-label sticky">All</h5>

                        <div class="scooch">
                            {#each GLOBAL_SETTINGS as s (s.id)}
                                <div class="setting">
                                    <span class="setting-label">{s.label}</span>
                                    <input
                                        type="range"
                                        min={s.min}
                                        max={s.max}
                                        step={s.step}
                                        bind:value={values[s.id]}
                                        ondblclick={() => values[s.id] = s.default}
                                    />
                                    <span class="setting-value">
                                        {s.format ? s.format(values[s.id]) : values[s.id]}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    </div>
                    
                    <div 
                        id="settings-individual"
                        class="inset-container"
                    >
                        <h5 class="axis-label sticky">{currentMode?.label}</h5>

                        <div class="scooch">
                            {#each currentMode?.settings ?? [] as s (s.id)}
                                <div class="setting">
                                    <span class="setting-label">{s.label}</span>
                                    <input
                                        type="range"
                                        min={s.min}
                                        max={s.max}
                                        step={s.step}
                                        bind:value={values[s.id]}
                                        ondblclick={() => values[s.id] = s.default}
                                    />
                                        <span class="setting-value">
                                            {s.format ? s.format(values[s.id]) : values[s.id]}
                                        </span>
                                </div>
                            {/each}
                        </div>
                    </div>
                </div>
                
                <div class="inset-container" id="playlist" style="padding: 0;">
                    <div id="playlist-selector">
                        <button class:active={player.currentPlaylist?.id === "myTracks"} onclick={() => player?.setPlaylist("myTracks")}>My Music</button>
                        <button class:active={player.currentPlaylist?.id === "uploadedTracks"} onclick={() => player?.setPlaylist("uploadedTracks")}>Your Music</button>
                    </div>

                    {#if player.currentPlaylist?.id === "myTracks"}
                        {#each player.currentPlaylist.tracks as track, index}
                            <button
                                class="playlist-item"
                                class:playing={index === player.currentTrackIndex}
                                onclick={() => player?.loadTrack(index, true)}
                            >
                                <span>
                                    <span class="idx">{(index + 1).toString().padStart(2, '0')}</span>{track.name}
                                </span>
                            </button>
                        {/each}
                    {:else if player.currentPlaylist?.id === "uploadedTracks" && player.getPlaylist("uploadedTracks")?.tracks.length === 0}
                        <!-- svelte-ignore <a11y_no_static_element_interactions, a11y_click_events_have_key_events> -->
                        <button 
                            id="dropzone" 
                            class="click-zone"
                            style="border-radius: 0 0 1rem 1rem;"
                            class:dragging={isDraggingOverPage}
                            onclick={() => document.getElementById('fileInput')?.click()}
                        >
                            <div>Drop audio files on the page, or click here to upload</div>
                            <input type="file" accept="audio/" id="fileInput" multiple onchange={onFileInputChange}>
                        </button>
                    {:else}
                        <!-- svelte-ignore <a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_consider_explicit_label> -->
                        <button 
                            id="dropzone" 
                            class="playlist-item" 
                            onclick={() => document.getElementById('fileInput')?.click()}
                        >
                            <div style="width: 100%; text-align: center; justify-self: center;">UPLOAD TRACK</div>
                            <input type="file" accept="audio/" id="fileInput" multiple onchange={onFileInputChange}>
                        </button>
                        {#each player.currentPlaylist?.tracks as track, index}
                            <button
                                class="playlist-item"
                                class:playing={index === player.currentTrackIndex}
                                onclick={() => player?.loadTrack(index, true)}
                            >
                                <span class="idx">{(index + 1).toString().padStart(2, '0')}</span>
                                <span class="playlist-item-label">{track.name}</span>
                            </button>
                        {/each}
                    {/if}
                </div>
            </div>
        </div>
    {/if}
</section>

<style>

</style>