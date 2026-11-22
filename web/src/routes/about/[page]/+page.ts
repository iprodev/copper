import locale from "$lib/i18n/locale";
import { get } from "svelte/store";
import { error } from "@sveltejs/kit";
import { loadAboutPage } from "$lib/i18n/about-pages";

import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
    const component = await loadAboutPage(get(locale), params.page);
    if (component) {
        return { component };
    }

    error(404, 'Not found');
};

export const prerender = true;
