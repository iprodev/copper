import { writable } from "svelte/store";
import type { FetchrDownloadButtonState } from "$lib/types/omnibox";

export const link = writable("");
export const downloadButtonState = writable<FetchrDownloadButtonState>("idle");
