<script
    lang="ts"
    generics="
        Context extends Exclude<keyof FetchrSettings, 'schemaVersion'>,
        Id extends keyof FetchrSettings[Context],
        Value extends FetchrSettings[Context][Id]
    "
>
    import { hapticSwitch } from "$lib/haptics";

    import settings, { updateSetting } from "$lib/state/settings";
    import type { FetchrSettings } from "$lib/types/settings";

    export let settingContext: Context;
    export let settingId: Id;
    export let settingValue: Value;

    $: setting = $settings[settingContext][settingId];
    $: isActive = setting === settingValue;
</script>

<button
    id="setting-button-{settingContext}-{String(settingId)}-{settingValue}"
    class="button"
    class:active={isActive}
    aria-pressed={isActive}
    on:click={() => {
        hapticSwitch();
        updateSetting({
            [settingContext]: {
                [settingId]: settingValue,
            },
        });
    }}
>
    <slot></slot>
</button>
