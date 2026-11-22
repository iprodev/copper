<script lang="ts">
    import { t } from "$lib/i18n/translations";
    import { contacts, docs } from "$lib/env";

    import SectionHeading from "$components/misc/SectionHeading.svelte";
</script>

<section id="summary">
<SectionHeading
    title={$t("about.heading.summary")}
    sectionId="summary"
/>

fetchr helps you save anything from your favorite websites: video, audio, photos or gifs. just paste the link and you're ready to go!

no ads, trackers, paywalls, or other nonsense. just a convenient web app that works anywhere, whenever you need it.
</section>

<section id="motivation">
<SectionHeading
    title={$t("about.heading.motivation")}
    sectionId="motivation"
/>

fetchr exists to protect people from ads and malware pushed by shady downloaders.
we believe that the best software is safe, open, and accessible.
</section>

<section id="privacy-efficiency">
<SectionHeading
    title={$t("about.heading.privacy_efficiency")}
    sectionId="privacy-efficiency"
/>

all requests to the backend are anonymous and all information about potential file tunnels is encrypted.
we have a strict zero log policy and don't store or track *anything* about individual people.

if a request requires additional processing, such as remuxing or transcoding, fetchr processes media
directly on your device. this ensures best efficiency and privacy.

if your device doesn't support local processing, then server-based live processing is used instead.
in this scenario, processed media is streamed directly to client, without ever being stored on server's disk.

you can [enable forced tunneling](/settings/privacy#tunnel) to boost privacy even further.
when enabled, fetchr will tunnel all downloaded files, not just those that require it.
no one will know where you download something from, even your network provider.
all they'll see is that you're using a fetchr instance.
</section>

<section id="community">
<SectionHeading
    title={$t("about.heading.community")}
    sectionId="community"
/>

fetchr is open source and [easily self-hostable]({docs.instanceHosting}).

if your friend hosts a processing instance, just ask them for a domain and [add it in instance settings](/settings/instances#community).

you can check the source code, report issues, and contribute [on github]({contacts.github}) at any time.
we welcome all contributions and suggestions!
</section>
