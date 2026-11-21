<script>
    import { t } from "$lib/i18n/translations";

    import Omnibox from "$components/save/Omnibox.svelte";
    import Mascot from "$components/misc/Mascot.svelte";
    import SupportedServices from "$components/save/SupportedServices.svelte";
</script>

<svelte:head>
    <title>{$t("general.fetchr")}</title>
    <meta property="og:title" content={$t("general.fetchr")} />
</svelte:head>

<div id="fetchr-save-container" class="center-column-container">
    <SupportedServices />
    <main
        id="fetchr-save"
        tabindex="-1"
        data-first-focus
    >
        <Mascot emotion="smile" />
        <Omnibox />
    </main>
    <div id="terms-note">
        {$t("save.terms.note.agreement")}
        <a href="/about/terms">{$t("save.terms.note.link")}</a>
    </div>
</div>

<style>
    #fetchr-save-container {
        padding: var(--padding);
        overflow: hidden;
    }

    #fetchr-save {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        gap: 15px;
    }

    #terms-note {
        bottom: 0;
        color: var(--gray);
        font-size: 12px;
        text-align: center;
        padding-bottom: 6px;
        font-weight: 500;
    }

    @media screen and (max-width: 535px) {
        #fetchr-save-container {
            padding-top: calc(var(--padding) / 2);
        }

        #terms-note {
            font-size: 11px;
            padding-bottom: 0;
        }
    }
</style>
