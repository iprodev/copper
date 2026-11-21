<script>
    import Mascot from "$components/misc/Mascot.svelte";

    export let pageName;
</script>

<div id="placeholder-container" class="center-column-container">
    <Mascot emotion="smile" />
    <div tabindex="-1" data-first-focus>
        {`${pageName} page is not ready yet!`}
    </div>
</div>

<style>
    #placeholder-container {
        gap: calc(var(--padding) * 2);
        text-align: center;
    }
</style>
