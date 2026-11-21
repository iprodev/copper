import type { RecursivePartial } from "$lib/types/generic";
import type { FetchrSettingsV2 } from "$lib/types/settings/v2";
import type { FetchrSettingsV3 } from "$lib/types/settings/v3";
import type { FetchrSettingsV4 } from "$lib/types/settings/v4";
import type { FetchrSettingsV5 } from "$lib/types/settings/v5";
import type { FetchrSettingsV6 } from "$lib/types/settings/v6";

export * from "$lib/types/settings/v2";
export * from "$lib/types/settings/v3";
export * from "$lib/types/settings/v4";
export * from "$lib/types/settings/v5";
export * from "$lib/types/settings/v6";

export type FetchrSettings = FetchrSettingsV6;

export type AnyFetchrSettings = FetchrSettingsV5 | FetchrSettingsV4 | FetchrSettingsV3 | FetchrSettingsV2 | FetchrSettings;

export type PartialSettings = RecursivePartial<FetchrSettings>;

export type AllPartialSettingsWithSchema = RecursivePartial<AnyFetchrSettings> & { schemaVersion: number };

export type DownloadModeOption = FetchrSettings['save']['downloadMode'];
