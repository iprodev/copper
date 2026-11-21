<script lang="ts">
    import { contacts, docs, upstream } from "$lib/env";
    import { t } from "$lib/i18n/translations";

    import SectionHeading from "$components/misc/SectionHeading.svelte";
</script>

<section id="based-on">
<SectionHeading
    title={$t("about.heading.based_on")}
    sectionId="based-on"
/>

fetchr is a modified version of [cobalt]({upstream.project}), an open source media downloader made by [imput](https://imput.net/).
huge thanks to the cobalt team and its contributors for their amazing work!

fetchr is not affiliated with or endorsed by imput or the cobalt project.
all fetchr branding is original and not related to cobalt's branding.
</section>

<section id="licenses">
<SectionHeading
    title={$t("about.heading.licenses")}
    sectionId="licenses"
/>

fetchr api (processing server) code is open source and licensed under [AGPL-3.0]({docs.apiLicense}).

fetchr frontend code is licensed under [CC-BY-NC-SA 4.0]({docs.webLicense}),
same as the original cobalt frontend it's based on.

we rely on many open source libraries. you can see the full list of dependencies on [github]({contacts.github})!
</section>
