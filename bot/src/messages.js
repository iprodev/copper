// bot texts in persian and english, picked by the user's telegram language

const fa = {
    help:
        "سلام! 👋\n\n" +
        "لینک ویدیو، عکس یا صدا را از سایت‌هایی مثل یوتیوب، اینستاگرام، تیک‌تاک، توییتر/ایکس، ساندکلاد و ... بفرستید تا فایلش را برایتان بفرستم.\n\n" +
        "برای گرفتن فقط صدا:\n/audio لینک\n\n" +
        "هیچ اطلاعاتی از شما یا لینک‌هایتان ذخیره نمی‌شود.",
    noLink: "لینکی پیدا نکردم. یک لینک کامل بفرستید (با https://).",
    notAllowed: "شما اجازه‌ی استفاده از این ربات را ندارید.",
    busy: "هنوز درخواست قبلی‌تان در حال انجام است. کمی صبر کنید.",
    rateLimited: "درخواست‌هایتان زیاد است. یک دقیقه‌ی دیگر دوباره امتحان کنید.",
    working: "⏳ در حال آماده‌سازی...",
    downloading: "⬇️ در حال دانلود...",
    uploading: "⬆️ در حال ارسال...",
    tooBig: (mb) => `این فایل برای تلگرام خیلی بزرگ است (حداکثر ${mb} مگابایت). کیفیت پایین‌تر یا فقط صدا (/audio) را امتحان کنید.`,
    errors: {
        unsupported: "این لینک پشتیبانی نمی‌شود. مطمئنید لینک درست را فرستاده‌اید؟",
        disabled: "این سرویس روی این سرور غیرفعال است.",
        empty: "فایلی برای دانلود در این لینک پیدا نکردم.",
        tooLong: (min) => `این فایل خیلی طولانی است. حداکثر زمان مجاز ${min} دقیقه است.`,
        private: "این محتوا خصوصی است و به آن دسترسی ندارم.",
        region: "این محتوا در کشوری که سرور در آن است در دسترس نیست.",
        age: "این محتوا محدودیت سنی دارد و بدون ورود به حساب قابل دانلود نیست.",
        live: "این ویدیو در حال پخش زنده است. بعد از تمام شدن پخش دوباره امتحان کنید.",
        paid: "این محتوا پولی است و قابل دانلود نیست.",
        rate: "سرور الان شلوغ است. چند ثانیه‌ی دیگر دوباره امتحان کنید.",
        config: "تنظیمات ربات مشکل دارد. لطفاً به مدیر ربات خبر دهید.",
        download: "دانلود فایل انجام نشد. کمی بعد دوباره امتحان کنید.",
        upload: "ارسال فایل به تلگرام انجام نشد. کمی بعد دوباره امتحان کنید.",
        generic: (code) => `مشکلی پیش آمد. کمی بعد دوباره امتحان کنید.${code ? `\n(${code})` : ""}`,
    },
};

const en = {
    help:
        "hi! 👋\n\n" +
        "send me a link to a video, photo or audio from sites like youtube, instagram, tiktok, twitter/x, soundcloud and more, and i'll send you the file.\n\n" +
        "to get just the audio:\n/audio link\n\n" +
        "nothing about you or your links is stored.",
    noLink: "i couldn't find a link. send a full link (with https://).",
    notAllowed: "you're not allowed to use this bot.",
    busy: "your previous request is still in progress. please wait a bit.",
    rateLimited: "you're making too many requests. try again in a minute.",
    working: "⏳ preparing...",
    downloading: "⬇️ downloading...",
    uploading: "⬆️ sending...",
    tooBig: (mb) => `this file is too big for telegram (max ${mb} MB). try a lower quality or just the audio (/audio).`,
    errors: {
        unsupported: "this link isn't supported. are you sure it's the right one?",
        disabled: "this service is disabled on this server.",
        empty: "i couldn't find anything to download at this link.",
        tooLong: (min) => `this media is too long. the limit is ${min} minutes.`,
        private: "this content is private, so i can't access it.",
        region: "this content isn't available in the server's country.",
        age: "this content is age-restricted and can't be downloaded anonymously.",
        live: "this video is live right now. try again after the stream ends.",
        paid: "this content is paid and can't be downloaded.",
        rate: "the server is busy right now. try again in a few seconds.",
        config: "the bot is misconfigured. please let the bot's admin know.",
        download: "couldn't download the file. try again a bit later.",
        upload: "couldn't send the file to telegram. try again a bit later.",
        generic: (code) => `something went wrong. try again a bit later.${code ? `\n(${code})` : ""}`,
    },
};

export const messages = (languageCode) =>
    String(languageCode ?? "").toLowerCase().startsWith("fa") ? fa : en;

// text for an error code from the fetchr api ("error.api.fetch.empty")
export const errorText = (t, code, context = {}) => {
    const key = String(code ?? "").replace(/^error\.api\./, "");

    if (/^(link\.|service\.unsupported)/.test(key)) return t.errors.unsupported;
    if (key === "service.disabled") return t.errors.disabled;
    if (key === "fetch.empty") return t.errors.empty;
    if (key === "content.too_long") return t.errors.tooLong(context.limit ?? "?");
    if (/private$/.test(key)) return t.errors.private;
    if (/region$/.test(key)) return t.errors.region;
    if (/age$/.test(key)) return t.errors.age;
    if (key === "content.video.live") return t.errors.live;
    if (key === "content.paid") return t.errors.paid;
    if (["rate_exceeded", "fetch.rate", "capacity", "timed_out"].includes(key)) return t.errors.rate;
    if (key.startsWith("auth.")) return t.errors.config;

    return t.errors.generic(key);
}
