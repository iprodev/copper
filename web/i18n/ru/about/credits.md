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

fetchr — это изменённая версия [cobalt]({upstream.project}), загрузчика медиа
с открытым исходным кодом от [imput](https://imput.net/).
огромное спасибо команде cobalt и всем её контрибьюторам за потрясающую работу!

fetchr не связан с imput или проектом cobalt и не одобрен ими.
весь брендинг fetchr оригинальный и не связан с брендингом cobalt.
</section>

<section id="licenses">
<SectionHeading
    title={$t("about.heading.licenses")}
    sectionId="licenses"
/>

код api (сервера обработки) fetchr — open source и распространяется по лицензии
[AGPL-3.0]({docs.apiLicense}).

код фронтенда fetchr распространяется по лицензии
[CC-BY-NC-SA 4.0]({docs.webLicense}), так же как и оригинальный фронтенд
cobalt, на котором он основан.

мы используем множество библиотек с открытым исходным кодом. полный список
зависимостей можно посмотреть [на github]({contacts.github})!
</section>
