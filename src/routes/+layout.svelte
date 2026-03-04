<script lang="ts">
	//import Header from './Header.svelte';
	import './layout.css';
	
	import { onMount } from "svelte";
	import { fly } from "svelte/transition";
	import { cubicIn, cubicOut } from 'svelte/easing';
    import { afterNavigate, beforeNavigate } from "$app/navigation";
	
    import { applyShakyTitles } from "$lib/shakyTitle";
    import Parallax from './Parallax.svelte';
    import MusicPlayerWidget from './MusicPlayerWidget.svelte';
    import NavDock from './NavDock.svelte';
	import SlideRevealPanel from '$lib/svelte/SlideRevealPanel.svelte';

	beforeNavigate(() => {
		// Smooth scroll to top on navigation
		// Works for now, but 
		if (typeof window !== 'undefined') {
			const scrollDuration = 1000;
			const startY = window.scrollY;
			const startTime = performance.now();
			
			function animateScroll(now: number) {
				const elapsed = now - startTime;
				const progress = Math.min(elapsed / scrollDuration, 1);
				// Ease in-out cubic
				const ease = progress < 0.5
					? 4 * progress * progress * progress
					: 1 - Math.pow(-2 * progress + 2, 3) / 2;
				window.scrollTo(0, startY * (1 - ease));
				if (progress < 1) {
					requestAnimationFrame(animateScroll);
				}
			}

			if (startY > 0) {
				requestAnimationFrame(animateScroll);
			}
		}
	});

	onMount(() => {
		applyShakyTitles();


		afterNavigate(() => {
			applyShakyTitles();
		});
	});

	let { children, data } = $props();

	let parallaxAutoScroll = $state(true);
	let parallaxSpeed = $state(2);
	let showUI = $state(true);
</script>

<div class="app">
   	<!-- <Header /> -->
   	<main>
		<Parallax autoScroll={parallaxAutoScroll} scrollSpeed={parallaxSpeed}/>

	   	{#if showUI}
			{#key data.pathname}
				<div 
					in:fly={{ duration: 1500, y: 50, easing: cubicOut, delay: 500 }}
					out:fly={{ duration: 500, y: -50, easing: cubicIn }}
				>
					{@render children()}
					<!-- <div class="big-spacer"></div> -->
				</div>
			{/key}

			<SlideRevealPanel label="Background" side="right">
				<div class="parallax-controller">
					<label>
						<input type="checkbox" bind:checked={parallaxAutoScroll}>
						Auto Scroll
					</label>
	
					<label>
						<input type="checkbox" bind:checked={showUI}>
						Show UI
					</label>
	
					<label>
						Speed: <input type="range" min="-50" max="50" step="0.5" bind:value={parallaxSpeed}>
						<span>{parallaxSpeed}</span>
					</label>
				</div>
			</SlideRevealPanel>

			<MusicPlayerWidget />
			<NavDock />

			<!-- <div class="big-spacer"></div> -->
		{:else}
			<div class="big-spacer"></div>

			<div class="parallax-controller">
				<label>
					<input type="checkbox" bind:checked={parallaxAutoScroll}>
					Auto Scroll
				</label>

				<label>
					<input type="checkbox" bind:checked={showUI}>
					Show UI
				</label>

				<label>
					Speed: <input type="range" min="-50" max="50" step="0.5" bind:value={parallaxSpeed}>
					<span>{parallaxSpeed}</span>
				</label>
			</div>
		{/if}

		<div class="vignette"></div>
   	</main>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		width: 100%;
		max-width: 70rem;
		margin: 0 auto;
		box-sizing: border-box;
	}

	.parallax-controller { 
		position: relative;
		padding: .5rem;
		border-radius: 8px;
		color: white;
		z-index: 10;
		font-family: inherit;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background-color: rgba(0,0,0,0.75);
		margin: 0 auto;
		min-width: 300px;
	}

	label {
		display: grid;
		grid-template-columns: 2fr 3fr 1fr;
		justify-items: center;
		align-items: center;
		text-align: center;
	}

	input[type="range"] {
		width: 100%;
	}
</style>
