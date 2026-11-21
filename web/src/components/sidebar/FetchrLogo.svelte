<script>
    import IconFetchr from "$components/icons/Fetchr.svelte";
</script>

<div id="fetchr-logo">
    <IconFetchr />
</div>

<style>
    #fetchr-logo {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: calc(var(--sidebar-tab-padding) * 2);
        color: var(--sidebar-highlight);

        /* accommodate space for scaling animation */
        padding-bottom: calc(var(--sidebar-tab-padding) * 2 - var(--sidebar-inner-padding));
    }

    #fetchr-logo :global(svg) {
        width: 26px;
        height: 26px;
    }

    @media screen and (max-width: 535px) {
        #fetchr-logo {
            display: none;
        }
    }
</style>
