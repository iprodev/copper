import defaults from "$lib/settings/defaults";
import type { FetchrSettings } from "$lib/types/settings";

export default function lazySettingGetter(settings: FetchrSettings) {
    // Returns the setting value only if it differs from the default.
    return <
        Context extends Exclude<keyof FetchrSettings, 'schemaVersion'>,
        Id extends keyof FetchrSettings[Context]
    >(context: Context, key: Id) => {
        if (defaults[context][key] !== settings[context][key]) {
            return settings[context][key];
        }
    }
}
