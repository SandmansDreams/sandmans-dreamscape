<script>

</script>


<div class="navdock">
    <div class="nav-trigger"></div>
    <nav class="nav-base">
        <div class="flex-row"> 
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
            <button class="nav-item">Test</button>
        </div>
    </nav>
</div>

<style>
    /* Invisible hover area at very bottom */
    .nav-trigger {
        position: fixed;
        bottom: 0;
        width: 100%;
        height: 40px;
        transform: translateY(-100px);
    }

    .navdock {
        position: fixed;
        bottom: 0;
        width: 100%;
        display: flex;
        justify-content: center;
        z-index: 5;

        transform: translateY(100px); 
        transition: transform 0.35s ease;
        pointer-events: none;
    }

    /* Show dock when hovering trigger OR dock itself */
    .nav-trigger:hover + .navdock,
    .navdock:hover {
        transform: 
            translateY(20px);
        pointer-events: auto;
    }

    .navdock:hover ~ .nav-trigger {
        pointer-events: none;
    }

    .nav-base {
        width: 80%;
        height: 120px;

        transform:
            perspective(75em)
            rotateX(60deg);

        background: rgba(0, 245, 255, 0.2);
        border-radius: 16px;
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(0.9px);
        -webkit-backdrop-filter: blur(0.9px);
        border: 1px solid rgba(0, 245, 255, 0.36);
    }

    .flex-row {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        width: 100%;
        height: 100%;
        gap: 0px;
    }

    .nav-item {
        flex: 1 1 120px;
        min-height: 40px;
    }
</style>