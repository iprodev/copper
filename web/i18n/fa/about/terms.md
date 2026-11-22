<script lang="ts">
    import { t } from "$lib/i18n/translations";
    import { contacts } from "$lib/env";
    import SectionHeading from "$components/misc/SectionHeading.svelte";
</script>

<section id="general">
<SectionHeading
    title={$t("about.heading.general")}
    sectionId="general"
/>

این شرایط فقط برای استفاده از سرور رسمی fetchr است.
برای سرورهای دیگر، باید اطلاعات دقیق را از کسی که آن سرور را راه انداخته بپرسید.
</section>

<section id="saving">
<SectionHeading
    title={$t("about.heading.saving")}
    sectionId="saving"
/>

قابلیت ذخیره، دانلود محتوا از اینترنت را ساده‌تر می‌کند
و ما هیچ مسئولیتی درباره‌ی اینکه محتوای ذخیره‌شده برای چه کاری استفاده می‌شود نداریم.

سرورهای پردازش مثل یک پراکسی پیشرفته کار می‌کنند و هیچ‌وقت محتوای درخواستی را روی دیسک نمی‌نویسند.
همه‌چیز در حافظه‌ی RAM انجام می‌شود و بعد از تمام شدن تونل برای همیشه پاک می‌شود.
ما هیچ لاگی از دانلودها نداریم و نمی‌توانیم کسی را شناسایی کنیم.

درباره‌ی نحوه‌ی کار تونل‌ها می‌توانید در [حریم خصوصی](/about/privacy) بیشتر بخوانید.
</section>

<section id="responsibility">
<SectionHeading
    title={$t("about.heading.responsibility")}
    sectionId="responsibility"
/>

شما (کاربر) مسئول کاری هستید که با ابزارهای ما انجام می‌دهید و مسئول نحوه‌ی استفاده و انتشار محتوای به‌دست‌آمده.
لطفاً هنگام استفاده از محتوای دیگران دقت کنید و همیشه نام سازندگان اصلی را ذکر کنید.
مطمئن شوید هیچ قانون یا مجوزی را زیر پا نمی‌گذارید.

هنگام استفاده‌ی آموزشی، همیشه منبع را ذکر کنید و نام سازندگان اصلی را بیاورید.

استفاده‌ی منصفانه و ذکر منبع به نفع همه است.
</section>

<section id="abuse">
<SectionHeading
    title={$t("about.heading.abuse")}
    sectionId="abuse"
/>

چون fetchr کاملاً ناشناس است، راهی برای تشخیص خودکار سوءاستفاده نداریم.
ولی می‌توانید چنین مواردی را [در گیت‌هاب]({contacts.github}) گزارش دهید تا تمام تلاشمان را برای رسیدگی به آن بکنیم.

اگر با fetchr مشکلی دارید، می‌توانید آن را هم [در گیت‌هاب]({contacts.github}) گزارش دهید.
</section>
