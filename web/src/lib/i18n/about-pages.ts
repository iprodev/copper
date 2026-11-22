import { defaultLocale } from "$lib/i18n/translations";

import type { Component } from "svelte";
import type { DefaultImport } from "$lib/types/generic";

const pages = import.meta.glob("$i18n/*/about/*.md");

const findPage = (locale: string, page: string) => Object.keys(pages).find(
    file => file.endsWith(`/${locale}/about/${page}.md`)
);

// about page in the given language, or in the default one if it isn't translated
export const loadAboutPage = async (locale: string, page: string) => {
    const path = findPage(locale, page) || findPage(defaultLocale, page);
    if (!path) return;

    const componentImport = pages[path] as DefaultImport<Component>;
    return (await componentImport()).default;
}
