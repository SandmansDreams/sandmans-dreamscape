<script lang="ts">
    import { onMount } from "svelte";
    import { persisted } from "$lib/svelte/store"

    import playIcon from "$lib/images/icons/Play-Icon.png"
    import pauseIcon from "$lib/images/icons/Pause-Icon.png"
    import nextIcon from "$lib/images/icons/Next-Icon.png"
    import previousIcon from "$lib/images/icons/Previous-Icon.png"
    import volumeIcon from "$lib/images/icons/Volume-Icon.png"
    import muteIcon from "$lib/images/icons/Mute-Icon.png"
    import shuffleIcon from "$lib/images/icons/Shuffle-Icon.png"
    import loopIcon from "$lib/images/icons/Loop-Icon.png"
    import loop1Icon from "$lib/images/icons/Loop-1-Icon.png"

    export const tracks: string[] | null = null
    let isCollapsed = persisted("player-collapsed", false)
    let hydrated = false

    type Track = {
        name: string
        src: string
    };

	let audio: HTMLAudioElement
	let currentIndex = 0

    let playlist: Track[] = []

	let isPlaying = false
    let isShuffle = true
    let isMuted = false
    let loopState = 1

    let currentTime = 0
    let duration = 0
    let volume = 1


    async function loadFromFolder() {
        const res = await fetch("/api/music");
        return await res.json();
    }

    function getRandomIndex(length: number) {
        if (length <= 1) return 0

        let rand

        do {
            rand = Math.floor(Math.random() * length)
        } while (rand === currentIndex)

        return rand;
    }

	function loadTrack(index: number) {
		currentIndex = index;
		audio.src = playlist[currentIndex].src;
		audio.load();
	}

    async function setPlayPause(bool: boolean) {
        if (bool) await audio.play()
        else audio.pause()
    }

    async function togglePlayPause() {
        if (audio.paused) await audio.play()
		else audio.pause()
    }

    function next() {
        if (isShuffle) currentIndex = getRandomIndex(playlist.length)
        else currentIndex = (currentIndex + 1) % playlist.length

        loadTrack(currentIndex)
        setPlayPause(true)
    }

    function previous() {
        if (currentTime > 3) audio.currentTime = 0
        else {
            currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;

            loadTrack(currentIndex)
            setPlayPause(true)
        }
    }

    function toggleShuffle() {
        isShuffle = !isShuffle
    }

    function toggleLoop() {
		loopState = (loopState + 1) % 3

        // Loop only if state 2
        audio.loop = loopState === 2
	}

    function toggleMute() {
		isMuted = !isMuted
		audio.muted = isMuted
    }

    function formatTime(time: number) {
		const minutes = Math.floor(time / 60)
		const seconds = Math.floor(time % 60)
			.toString()
			.padStart(2, "0")

		return `${minutes}:${seconds}`
	}

    function toggleCollapse() {
        $isCollapsed = !$isCollapsed
    }

    function getCookie(name: string) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop()?.split(";").shift();
    }

    onMount(async () => {
        hydrated = true 

        if (tracks) playlist = tracks 
        else playlist = await loadFromFolder()
        loadTrack(getRandomIndex(playlist.length))

        console.log(JSON.stringify(playlist))

        audio.addEventListener("play", () => (isPlaying = true));
		audio.addEventListener("pause", () => (isPlaying = false));

		audio.addEventListener("timeupdate", () => {
			currentTime = audio.currentTime
		})

		audio.addEventListener("loadedmetadata", () => {
			duration = audio.duration
		})

		audio.addEventListener("ended", () => {
			if (loopState !== 2) next()
		})
    })

    $: progressPercent = duration
        ? `${(currentTime / duration) * 100}%`
        : "0%";
</script>

<div class="music-widget">
    {#if hydrated && !$isCollapsed}
        <div class="player">
            <!-- Header -->
            <div class="header">
                <span>MY MUSIC PLAYER | (Music I have made or are making)</span>
                <button class="close-button" on:click={toggleCollapse}>x</button>
            </div>
            <!-- Controls -->
            <div class="controls">
                <button on:click={previous}>
                    <img src={previousIcon} alt="previous">
                </button>
        
                <button on:click={togglePlayPause}>
                    {#if isPlaying}
                        <img src={pauseIcon} alt="pause">
                    {:else}
                        <img src={playIcon} alt="play">
                    {/if}
                </button>
        
                <button on:click={next}>
                    <img src={nextIcon} alt="shuffle">
                </button>
        
                <button on:click={toggleShuffle} class:active={isShuffle}>
                    <img src={shuffleIcon} alt="shuffle">
                </button>
        
                <button on:click={toggleLoop} class:active={loopState !== 0}>
                    {#if loopState === 2}
                        <img src={loop1Icon} alt="loop 1">
                    {:else}
                        <img src={loopIcon} alt="loop">
                    {/if}
                </button>
        
                <!-- Volume -->
                <span class="volume">
                    <button on:click={toggleMute} class:active={isMuted}>
                        {#if isMuted || volume === 0}
                            <img src={muteIcon} alt="mute">
                        {:else}
                            <img src={volumeIcon} alt="volume">
                        {/if}
                    </button>
        
                    <input
                        type="range"
                        class="volume-slider"
                        min="0"
                        max="1"
                        step="0.01"
                        bind:value={volume}
                        on:input={() => (audio.volume = volume)}
                    />
                </span>
            </div>
        
            <!-- Info -->
            <div class="track-info">
                <select
                    class="data-display"
                    bind:value={currentIndex}
                    on:change={() => {
                        loadTrack(currentIndex)
                        setPlayPause(true)
                    }}
                >
                    {#each playlist as track, i}
                        <option value={i}>
                            {track.name}
                        </option>
                    {/each}
                </select>
            </div>
        
            <!-- Progress -->
            <div class="progress">
                <span>{formatTime(currentTime)}</span>
        
                <input
                    type="range"
                    class="progress-slider"
                    min="0"
                    max={duration}
                    step="0.1"
                    bind:value={currentTime}
                    on:input={() => (audio.currentTime = currentTime)}
                    style={`--progress: ${progressPercent}`}
                />
        
                <span>{formatTime(duration)}</span>
            </div>
        </div>
    {:else}
        <button on:click={toggleCollapse}>
            <img src={volumeIcon} alt="music">
        </button>
    {/if}
    
    <audio bind:this={audio}></audio>
</div>

<style>
	button {
		background: none;
		border: outset rgb(189, 189, 189) 3px;
		padding: .5rem;
		cursor: pointer;

        display: flex;             
        justify-content: center;  
        align-items: center;
	}
	button.active {
		background: gray;
	}
    button:active, button.active:active {
        border: inset rgb(189, 189, 189) 3px;
    }

    img {
        width: 20px;
        height: 20px;
        align-self: center;
    }

	input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        cursor: pointer;
        flex: 1;
        height: 24px;
        display: flex;
        align-items: center;
        align-self: center;
    }

    .progress-slider::-webkit-slider-runnable-track {
        height: 8px;
        border: inset rgb(189, 189, 189) 3px;
        background: linear-gradient(
            to right,
            rgb(0, 112, 0) 0%,
            rgb(0, 255, 0) var(--progress),
            rgb(0, 0, 0) var(--progress),
            rgb(0, 0, 0)
        );
    }

    .progress-slider::-moz-range-track {
        height: 8px;
        border: inset rgb(189, 189, 189) 3px;
        background: rgb(160, 160, 160);
    }

    .volume-slider::-webkit-slider-runnable-track {
        height: 6px;
        background: rgb(0, 0, 0);
        border: inset rgb(189, 189, 189) 2px;
    }

    .volume-slider::-moz-range-track {
        height: 6px;
        background: rgb(210, 210, 210);
        border: inset rgb(189, 189, 189) 2px;
    }

    input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 20px;
        background: rgb(210, 210, 210);
        border: outset rgb(189, 189, 189) 3px;
        transform: translateY(-10px);
    }

    input[type="range"]::-moz-range-thumb {
        width: 16px;
        height: 20px;
        background: rgb(210, 210, 210);
        border: outset rgb(189, 189, 189) 3px;
    }


    .music-widget {
        position: fixed;
        bottom: 1rem;
        left: 1rem;
        background-color: rgb(173, 173, 173);
        user-select: none;
    }

	.player {
		display: flex;
		flex-direction: column;
		gap: .5rem;
        width: fit-content;

        color: rgb(0, 0, 0);
        padding: .5rem;
        border: outset rgb(189, 189, 189) 3px;

        font-family: 'Courier New', Courier, monospace;
        font-weight: bold;
	}

    .header {
        display: grid;
        grid-template-columns: auto auto;
        gap: space-between;
        align-items: center;
    }

	.controls {
        position: relative;
        top: 0;
        right: 0;
		display: flex;
		justify-content: left;
	}

    .data-display {
        background-color: black;
        font-family: 'Courier New', Courier, monospace;
        font-weight: bold;
        font-size: large;
        color: rgb(0, 190, 0);
        padding: 3px;
        border: inset gray 3px;
        margin: 0;
        text-align: left;
        text-indent: 0;
        text-wrap-mode: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
    }

	.progress,
	.volume {
        width: 100%;
		display: flex;
		gap: 0.5rem;
        align-items: center;
	}

    .close-button {
        padding: 0;
        width: 20px;
        height: 20px;
        line-height: 0;
        display: flex;             
        justify-content: center;  
        align-items: center;
    }
</style>