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

fetchr نسخه‌ی تغییریافته‌ی [cobalt]({upstream.project}) است؛ یک دانلودر متن‌باز که [imput](https://imput.net/) ساخته است.
از تیم cobalt و همه‌ی مشارکت‌کنندگانش برای کار فوق‌العاده‌شان صمیمانه سپاسگزاریم!

fetchr هیچ ارتباطی با imput یا پروژه‌ی cobalt ندارد و از طرف آن‌ها تأیید نشده است.
همه‌ی نشان‌ها و طراحی‌های fetchr اختصاصی است و به نشان‌های cobalt ربطی ندارد.
</section>

<section id="licenses">
<SectionHeading
    title={$t("about.heading.licenses")}
    sectionId="licenses"
/>

کد API fetchr (سرور پردازش) متن‌باز است و با مجوز [AGPL-3.0]({docs.apiLicense}) منتشر شده.

کد بخش وب fetchr با مجوز [CC-BY-NC-SA 4.0]({docs.webLicense}) منتشر شده؛
همان مجوز بخش وب cobalt که fetchr بر پایه‌ی آن ساخته شده.

ما از کتابخانه‌های متن‌باز زیادی استفاده می‌کنیم. فهرست کامل آن‌ها را می‌توانید [در گیت‌هاب]({contacts.github}) ببینید!
</section>
