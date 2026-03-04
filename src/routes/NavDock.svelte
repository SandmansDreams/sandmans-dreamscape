
<script>
    import SecretText from "./SecretText.svelte";
    import SlideRevealPanel from "$lib/svelte/SlideRevealPanel.svelte";
</script>


<SlideRevealPanel label="Navigation" side="bottom">
    <nav class="nav-base crt">
        <div class="flex-row"> 
            <a href="/" class="nav-item" data-sveltekit-noscroll>Homepage</a>
            <a href="/about" class="nav-item" data-sveltekit-noscroll>About (WIP)</a>
            <a href="/neighborhood" class="nav-item" data-sveltekit-noscroll>Neighbors</a>
            <a href="/guestbook" class="nav-item" data-sveltekit-noscroll><SecretText text="Guestbook (WIP)"/></a>
            <a href="/projects" class="nav-item" data-sveltekit-noscroll><SecretText text="Projects (WIP)"/></a>
            <a href="/tools" class="nav-item" data-sveltekit-noscroll><SecretText text="Tools (WIP)"/></a>
            <a href="/articles" class="nav-item" data-sveltekit-noscroll><SecretText text="Articles (WIP)"/></a>
        </div>
    </nav>
</SlideRevealPanel>

<style>
    .nav-base {
        width: 90%;
        height: 120px;

        transform:
            perspective(75em)
            rotateX(40deg);

        background: rgba(0, 245, 255, 0.2);
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(0.9px);
        -webkit-backdrop-filter: blur(0.9px);
        border: 3px solid rgba(0, 245, 255, 0.2);
        padding: .5rem;
        gap: 5px;
        border-radius: 1rem;
        overflow: hidden;
    }

    .flex-row {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        width: 100%;
        height: 100%;
        gap: 5px;
    }

    .nav-item {
        flex: 1 1 120px;
        min-height: 40px;
        font-family: inherit;
        font-size: 16pt;
        transition: .5s ease;
        border: 3px solid rgba(0, 245, 255, 0.2);
        color: rgb(0, 229, 255);
        background-color: rgba(0, 245, 255, 0.2);
        text-align: center;
        align-content: center;
        text-decoration: none;
        border-radius: 1rem;
        padding-inline: 5px;
    }

    .nav-item:hover {
        transition: .5s ease;
        background-color: rgba(2, 166, 172, 0.5);
    }

    .nav-item:active {
        background-color: rgba(1, 85, 88, 0.5);
        transition: 0s;
        color: white;
        transform: scale(0.9);
    }
</style>