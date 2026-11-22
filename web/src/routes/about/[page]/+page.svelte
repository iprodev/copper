<script lang="ts">
    import { onMount } from "svelte";
    import type { PageData } from './$types';
    export let data: PageData;

    // pages are prerendered in the default language. hydration keeps the
    // prerendered text, so the page is rendered again once it's mounted,
    // in the viewer's language.
    let mounted = false;
    onMount(() => {
        mounted = true;
    });
</script>

{#key mounted}
    <svelte:component this={data.component} />
{/key}
