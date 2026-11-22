// bot texts in persian and english

const fa = {
    languageName: "فارسی",
    chooseLanguage: "🌐 زبان را انتخاب کنید:\nChoose your language:",
    languageSet: "✅ زبان ربات فارسی شد.",

    welcome:
        "سلام! 👋 به ربات fetchr خوش آمدید.\n\n" +
        "لینک ویدیو، عکس یا صدا را از سایت‌هایی مثل یوتیوب، اینستاگرام، تیک‌تاک، توییتر/ایکس، ساندکلاد، پینترست و ... بفرستید تا فایلش را برایتان بفرستم.",
    help:
        "📖 راهنمای استفاده\n\n" +
        "۱. لینک پست یا ویدیو را از برنامه‌ی مورد نظر کپی کنید (دکمه‌ی «اشتراک‌گذاری» ← «کپی لینک»).\n" +
        "۲. لینک را اینجا بفرستید.\n" +
        "۳. کیفیت را انتخاب کنید تا فایل برایتان فرستاده شود.\n\n" +
        "🎵 برای گرفتن فقط صدا: کیفیت «فقط صدا» را انتخاب کنید، یا بنویسید:\n/audio لینک\n\n" +
        "⚙️ /settings: کیفیت پیش‌فرض، تا هر بار پرسیده نشود\n" +
        "🌐 /language: تغییر زبان\n" +
        "🎁 /invite: دعوت دوستان و سهمیه‌ی بیشتر\n\n" +
        "💬 در هر چتی بنویسید @{{ bot }} و لینک را بگذارید تا فایل‌هایی که قبلاً گرفته شده‌اند را همان‌جا بفرستید.\n\n" +
        "📦 حداکثر حجم هر فایل {{ limit }} مگابایت است. برای ویدیوهای طولانی کیفیت پایین‌تر را انتخاب کنید.\n\n" +
        "🔒 لینک‌هایی که می‌فرستید هیچ‌جا ذخیره نمی‌شوند. فقط شناسه‌ی تلگرام، زبان و تنظیمات شما نگه داشته می‌شود.",

    buttons: {
        help: "📖 راهنما",
        settings: "⚙️ تنظیمات",
        language: "🌐 زبان",
        invite: "🎁 دعوت دوستان",
    },

    noLink: "لینکی پیدا نکردم. یک لینک کامل بفرستید (مثلاً https://...).",
    banned: "⛔️ دسترسی شما به ربات مسدود شده است.",
    maintenance: "🛠 ربات در حال به‌روزرسانی است. کمی بعد دوباره امتحان کنید.",
    busy: "هنوز درخواست قبلی‌تان در حال انجام است. کمی صبر کنید.",
    rateLimited: "درخواست‌هایتان زیاد است. یک دقیقه‌ی دیگر دوباره امتحان کنید.",

    join: {
        prompt: "📢 برای استفاده از ربات، اول در کانال‌های زیر عضو شوید و بعد دکمه‌ی «عضو شدم» را بزنید:",
        check: "✅ عضو شدم",
        notYet: "هنوز در همه‌ی کانال‌ها عضو نشده‌اید.",
        done: "✅ ممنون! حالا لینک را بفرستید.",
    },

    quality: {
        choose: "🎬 کیفیت را انتخاب کنید:",
        audio: "🎵 فقط صدا",
        cancel: "❌ لغو",
        canceled: "لغو شد.",
        expired: "این درخواست منقضی شده. لینک را دوباره بفرستید.",
        ask: "هر بار بپرس",
    },

    settings: {
        title: "⚙️ کیفیت پیش‌فرض\n\nاگر کیفیتی انتخاب کنید، بعد از فرستادن لینک دیگر پرسیده نمی‌شود.\n\nالان: {{ current }}",
        saved: "✅ ذخیره شد: {{ current }}",
    },

    working: "⏳ در حال آماده‌سازی...",
    downloading: "⬇️ در حال دانلود...",
    uploading: "⬆️ در حال ارسال...",
    tooBig: "این فایل برای تلگرام خیلی بزرگ است (حداکثر {{ limit }} مگابایت). کیفیت پایین‌تر یا فقط صدا را امتحان کنید.",

    queued: "⏳ در صف هستید. نفر {{ position }}...",
    fromCache: "⚡️",

    invite: {
        title:
            "🎁 دعوت دوستان\n\n" +
            "این لینک را برای دوستانتان بفرستید. {{ bonus }}\n\n" +
            "{{ link }}\n\n" +
            "👥 دعوت‌شده‌ها: {{ count }}\n" +
            "📥 دانلود امروز: {{ used }} از {{ limit }}",
        bonus: "به ازای هر نفر که با لینک شما عضو شود، {{ perInvite }} دانلود به سهمیه‌ی روزانه‌تان اضافه می‌شود.",
        noBonus: "",
        unlimited: "نامحدود",
        joined: "🎉 یک نفر با لینک دعوت شما عضو شد!{{ bonus }}",
        joinedBonus: " سهمیه‌ی روزانه‌ی شما {{ perInvite }} دانلود بیشتر شد.",
    },

    quota: {
        exceeded:
            "سهمیه‌ی دانلود امروز شما تمام شده ({{ limit }} فایل در روز).\n\n" +
            "فردا دوباره امتحان کنید، یا با دعوت دوستان سهمیه‌ی بیشتری بگیرید: /invite",
    },

    group: {
        usage: "برای دانلود در گروه بنویسید:\n/dl لینک",
        startPrivate: "📥 دانلود در ربات",
    },

    inline: {
        notCached: "📥 این لینک را اول در ربات بفرستید",
        hint: "📥 لینک یک ویدیو یا پست را بنویسید",
    },
    errors: {
        unsupported: "این لینک پشتیبانی نمی‌شود. مطمئنید لینک درست را فرستاده‌اید؟",
        disabled: "این سرویس روی این سرور غیرفعال است.",
        empty: "فایلی برای دانلود در این لینک پیدا نکردم.",
        tooLong: "این فایل خیلی طولانی است. حداکثر زمان مجاز {{ limit }} دقیقه است.",
        private: "این محتوا خصوصی است و به آن دسترسی ندارم.",
        region: "این محتوا در کشوری که سرور در آن است در دسترس نیست.",
        age: "این محتوا محدودیت سنی دارد و بدون ورود به حساب قابل دانلود نیست.",
        live: "این ویدیو در حال پخش زنده است. بعد از تمام شدن پخش دوباره امتحان کنید.",
        paid: "این محتوا پولی است و قابل دانلود نیست.",
        rate: "سرور الان شلوغ است. چند ثانیه‌ی دیگر دوباره امتحان کنید.",
        config: "تنظیمات ربات مشکل دارد. لطفاً به مدیر ربات خبر دهید.",
        download: "دانلود فایل انجام نشد. کمی بعد دوباره امتحان کنید.",
        upload: "ارسال فایل به تلگرام انجام نشد. کمی بعد دوباره امتحان کنید.",
        generic: "مشکلی پیش آمد. کمی بعد دوباره امتحان کنید.",
    },

    admin: {
        title: "🛠 پنل مدیریت",
        back: "↩️ بازگشت",
        cancel: "❌ لغو",
        canceled: "لغو شد.",
        notAdmin: "این بخش فقط برای مدیران است.",

        stats: "📊 آمار",
        statsText:
            "📊 آمار ربات\n\n" +
            "👥 کاربران: {{ users }}\n" +
            "✅ فعال: {{ active }}\n" +
            "🚫 ربات را بلاک کرده‌اند: {{ blocked }}\n" +
            "⛔️ مسدود شده: {{ banned }}\n" +
            "⭐️ ویژه: {{ vip }}\n" +
            "🎁 با دعوت آمده‌اند: {{ invited }}\n\n" +
            "🆕 کاربران جدید امروز: {{ newToday }}\n" +
            "🆕 کاربران جدید ۷ روز اخیر: {{ newWeek }}\n" +
            "🟢 فعال امروز: {{ activeToday }}\n\n" +
            "⬇️ دانلود امروز: {{ downloadsToday }}\n" +
            "⬇️ دانلود ۷ روز اخیر: {{ downloadsWeek }}\n" +
            "⬇️ کل دانلودها: {{ downloadsTotal }}\n" +
            "⚡️ فایل‌های آماده برای ارسال فوری: {{ cachedFiles }}\n\n" +
            "🔝 سرویس‌های پرکاربرد (۷ روز):\n{{ top }}",
        none: "—",

        broadcast: "📣 پیام همگانی",
        broadcastPrompt: "📣 پیامی را که می‌خواهید برای همه‌ی کاربران فرستاده شود بفرستید (متن، عکس، ویدیو، فایل یا پیام فوروارد شده).",
        broadcastConfirm: "این پیام برای {{ count }} کاربر فرستاده شود؟",
        broadcastSend: "✅ بفرست",
        broadcastRunning: "📣 در حال ارسال... ({{ done }}/{{ total }})",
        broadcastBusy: "یک پیام همگانی دیگر در حال ارسال است.",
        broadcastDone: "📣 پیام همگانی تمام شد.\n\n✅ فرستاده شد: {{ sent }}\n🚫 ربات را بلاک کرده بودند: {{ blocked }}\n⚠️ خطا: {{ failed }}",

        channels: "📢 عضویت اجباری",
        channelsText: "📢 عضویت اجباری\n\nکاربران فقط بعد از عضویت در این کانال‌ها می‌توانند از ربات استفاده کنند. ربات باید در هر کانال مدیر باشد.\n\n{{ list }}",
        channelsEmpty: "هیچ کانالی تنظیم نشده و عضویت اجباری خاموش است.",
        channelAdd: "➕ افزودن کانال",
        channelRemove: "❌ حذف {{ title }}",
        channelPrompt: "شناسه‌ی کانال را بفرستید (مثلاً @mychannel)، یا یک پیام از کانال را اینجا فوروارد کنید.\n\nقبلش ربات را در کانال مدیر کنید.",
        channelAdded: "✅ کانال «{{ title }}» اضافه شد.",
        channelRemoved: "کانال حذف شد.",
        channelNotFound: "این کانال پیدا نشد. مطمئن شوید شناسه درست است و ربات عضو کانال است.",
        channelNotAdmin: "ربات در این کانال مدیر نیست. اول ربات را مدیر کانال کنید.",
        channelNoLink: "لینک کانال پیدا نشد. به ربات اجازه‌ی «دعوت کاربران با لینک» بدهید یا کانال را عمومی کنید.",

        welcome: "👋 پیام خوش‌آمد",
        welcomeText: "👋 پیام خوش‌آمد\n\nفارسی:\n{{ fa }}\n\nEnglish:\n{{ en }}",
        welcomeEditFa: "✏️ فارسی",
        welcomeEditEn: "✏️ English",
        welcomeReset: "↩️ پیش‌فرض",
        welcomePrompt: "متن جدید پیام خوش‌آمد را بفرستید.",
        welcomeSaved: "✅ پیام خوش‌آمد ذخیره شد.",
        welcomeDefault: "(پیش‌فرض)",

        users: "👤 مسدود کردن کاربر",
        usersPrompt: "شناسه‌ی عددی کاربر را بفرستید. برای رفع مسدودیت، قبلش یک منفی بگذارید (مثلاً -123456).",
        userBanned: "⛔️ کاربر {{ id }} مسدود شد.",
        userUnbanned: "✅ کاربر {{ id }} از مسدودیت خارج شد.",
        userNotFound: "این کاربر هنوز از ربات استفاده نکرده.",
        userInvalid: "شناسه باید عدد باشد.",
        userIsAdmin: "مدیرها را نمی‌توان مسدود کرد.",

        maintenanceOn: "🛠 حالت تعمیر: روشن",
        maintenanceOff: "🛠 حالت تعمیر: خاموش",
        maintenanceToggled: "حالت تعمیر {{ state }} شد. در این حالت فقط مدیرها می‌توانند از ربات استفاده کنند.",
        on: "روشن",
        off: "خاموش",

        caption: "✍️ امضای فایل‌ها",
        captionText: "✍️ امضای زیر فایل‌ها\n\nالان: {{ current }}\n\nمتن جدید را بفرستید، یا «-» برای حذف امضا.",
        captionNone: "(بدون امضا)",
        captionSaved: "✅ امضا ذخیره شد.",

        quota: "🎟 سهمیه",
        quotaText:
            "🎟 سهمیه‌ی روزانه\n\n" +
            "سهمیه‌ی هر کاربر در روز: {{ daily }}\n" +
            "دانلود اضافه برای هر دعوت: {{ perInvite }}\n" +
            "کاربران ویژه (بدون محدودیت): {{ vip }}",
        quotaUnlimited: "نامحدود",
        quotaEditDaily: "✏️ سهمیه‌ی روزانه",
        quotaEditInvite: "✏️ جایزه‌ی دعوت",
        quotaDailyPrompt: "تعداد دانلود مجاز هر کاربر در روز را بفرستید (۰ یعنی نامحدود).",
        quotaInvitePrompt: "تعداد دانلود اضافه به ازای هر دعوت را بفرستید (۰ یعنی بدون جایزه).",
        quotaSaved: "✅ ذخیره شد.",
        numberInvalid: "یک عدد بفرستید.",

        vip: "⭐️ کاربر ویژه",
        vipPrompt: "شناسه‌ی عددی کاربر را بفرستید تا ویژه شود (بدون محدودیت سهمیه). برای برداشتن، قبلش یک منفی بگذارید.",
        vipAdded: "⭐️ کاربر {{ id }} ویژه شد.",
        vipRemoved: "کاربر {{ id }} دیگر ویژه نیست.",

        groupsOn: "👥 گروه‌ها: روشن",
        groupsOff: "👥 گروه‌ها: خاموش",
        groupsToggled: "کار در گروه‌ها {{ state }} شد. در گروه‌ها با دستور /dl لینک کار می‌کند.",

        backup: "💾 پشتیبان",
        backupCaption: "💾 پشتیبان ربات fetchr، {{ date }}\n👥 {{ users }} کاربر",
        backupFailed: "⚠️ ساختن پشتیبان انجام نشد.",

    },
};

const en = {
    languageName: "English",
    chooseLanguage: fa.chooseLanguage,
    languageSet: "✅ the bot's language is now english.",

    welcome:
        "hi! 👋 welcome to the fetchr bot.\n\n" +
        "send me a link to a video, photo or audio from sites like youtube, instagram, tiktok, twitter/x, soundcloud, pinterest and more, and i'll send you the file.",
    help:
        "📖 how to use\n\n" +
        "1. copy the link of a post or video in the app (\"share\" → \"copy link\").\n" +
        "2. send the link here.\n" +
        "3. pick a quality and the file will be sent to you.\n\n" +
        "🎵 to get just the audio, pick \"audio only\", or send:\n/audio link\n\n" +
        "⚙️ /settings: default quality, so you're not asked every time\n" +
        "🌐 /language: change the language\n" +
        "🎁 /invite: invite friends for more downloads\n\n" +
        "💬 in any chat, type @{{ bot }} and a link to send files that were downloaded before right there.\n\n" +
        "📦 files can be up to {{ limit }} MB. pick a lower quality for long videos.\n\n" +
        "🔒 links you send are never stored. only your telegram id, language and settings are kept.",

    buttons: {
        help: "📖 help",
        settings: "⚙️ settings",
        language: "🌐 language",
        invite: "🎁 invite friends",
    },

    noLink: "i couldn't find a link. send a full link (like https://...).",
    banned: "⛔️ you're banned from using this bot.",
    maintenance: "🛠 the bot is being updated. try again a bit later.",
    busy: "your previous request is still in progress. please wait a bit.",
    rateLimited: "you're making too many requests. try again in a minute.",

    join: {
        prompt: "📢 to use the bot, join these channels first, then press \"i've joined\":",
        check: "✅ i've joined",
        notYet: "you haven't joined all channels yet.",
        done: "✅ thanks! now send me a link.",
    },

    quality: {
        choose: "🎬 pick a quality:",
        audio: "🎵 audio only",
        cancel: "❌ cancel",
        canceled: "canceled.",
        expired: "this request expired. send the link again.",
        ask: "ask every time",
    },

    settings: {
        title: "⚙️ default quality\n\nif you pick a quality, you won't be asked after sending a link.\n\ncurrent: {{ current }}",
        saved: "✅ saved: {{ current }}",
    },

    working: "⏳ preparing...",
    downloading: "⬇️ downloading...",
    uploading: "⬆️ sending...",
    tooBig: "this file is too big for telegram (max {{ limit }} MB). try a lower quality or just the audio.",

    queued: "⏳ you're in the queue, number {{ position }}...",
    fromCache: "⚡️",

    invite: {
        title:
            "🎁 invite friends\n\n" +
            "send this link to your friends. {{ bonus }}\n\n" +
            "{{ link }}\n\n" +
            "👥 invited: {{ count }}\n" +
            "📥 downloads today: {{ used }} of {{ limit }}",
        bonus: "for each friend who joins with your link, you get {{ perInvite }} more downloads per day.",
        noBonus: "",
        unlimited: "unlimited",
        joined: "🎉 someone joined with your invite link!{{ bonus }}",
        joinedBonus: " you get {{ perInvite }} more downloads per day.",
    },

    quota: {
        exceeded:
            "you've used today's downloads ({{ limit }} files per day).\n\n" +
            "try again tomorrow, or invite friends to get more: /invite",
    },

    group: {
        usage: "to download in a group, send:\n/dl link",
        startPrivate: "📥 download in the bot",
    },

    inline: {
        notCached: "📥 send this link to the bot first",
        hint: "📥 type the link of a video or post",
    },
    errors: {
        unsupported: "this link isn't supported. are you sure it's the right one?",
        disabled: "this service is disabled on this server.",
        empty: "i couldn't find anything to download at this link.",
        tooLong: "this media is too long. the limit is {{ limit }} minutes.",
        private: "this content is private, so i can't access it.",
        region: "this content isn't available in the server's country.",
        age: "this content is age-restricted and can't be downloaded anonymously.",
        live: "this video is live right now. try again after the stream ends.",
        paid: "this content is paid and can't be downloaded.",
        rate: "the server is busy right now. try again in a few seconds.",
        config: "the bot is misconfigured. please let the bot's admin know.",
        download: "couldn't download the file. try again a bit later.",
        upload: "couldn't send the file to telegram. try again a bit later.",
        generic: "something went wrong. try again a bit later.",
    },

    admin: {
        title: "🛠 admin panel",
        back: "↩️ back",
        cancel: "❌ cancel",
        canceled: "canceled.",
        notAdmin: "this is only for admins.",

        stats: "📊 stats",
        statsText:
            "📊 bot stats\n\n" +
            "👥 users: {{ users }}\n" +
            "✅ active: {{ active }}\n" +
            "🚫 blocked the bot: {{ blocked }}\n" +
            "⛔️ banned: {{ banned }}\n" +
            "⭐️ vip: {{ vip }}\n" +
            "🎁 joined by invite: {{ invited }}\n\n" +
            "🆕 new today: {{ newToday }}\n" +
            "🆕 new in the last 7 days: {{ newWeek }}\n" +
            "🟢 active today: {{ activeToday }}\n\n" +
            "⬇️ downloads today: {{ downloadsToday }}\n" +
            "⬇️ downloads in the last 7 days: {{ downloadsWeek }}\n" +
            "⬇️ all downloads: {{ downloadsTotal }}\n" +
            "⚡️ files ready to send instantly: {{ cachedFiles }}\n\n" +
            "🔝 top services (7 days):\n{{ top }}",
        none: "—",

        broadcast: "📣 broadcast",
        broadcastPrompt: "📣 send the message that should go to all users (text, photo, video, file or a forwarded message).",
        broadcastConfirm: "send this message to {{ count }} users?",
        broadcastSend: "✅ send",
        broadcastRunning: "📣 sending... ({{ done }}/{{ total }})",
        broadcastBusy: "another broadcast is still being sent.",
        broadcastDone: "📣 broadcast finished.\n\n✅ sent: {{ sent }}\n🚫 had blocked the bot: {{ blocked }}\n⚠️ errors: {{ failed }}",

        channels: "📢 required channels",
        channelsText: "📢 required channels\n\nusers can only use the bot after joining these channels. the bot must be an admin in each of them.\n\n{{ list }}",
        channelsEmpty: "no channels are set, joining isn't required.",
        channelAdd: "➕ add a channel",
        channelRemove: "❌ remove {{ title }}",
        channelPrompt: "send the channel's username (e.g. @mychannel), or forward a message from the channel here.\n\nmake the bot an admin of the channel first.",
        channelAdded: "✅ channel \"{{ title }}\" added.",
        channelRemoved: "channel removed.",
        channelNotFound: "couldn't find this channel. make sure the username is right and the bot is in the channel.",
        channelNotAdmin: "the bot isn't an admin in this channel. make it an admin first.",
        channelNoLink: "couldn't get a link to the channel. let the bot invite users via link, or make the channel public.",

        welcome: "👋 welcome message",
        welcomeText: "👋 welcome message\n\nفارسی:\n{{ fa }}\n\nenglish:\n{{ en }}",
        welcomeEditFa: "✏️ فارسی",
        welcomeEditEn: "✏️ english",
        welcomeReset: "↩️ default",
        welcomePrompt: "send the new welcome message.",
        welcomeSaved: "✅ welcome message saved.",
        welcomeDefault: "(default)",

        users: "👤 ban a user",
        usersPrompt: "send the user's numeric id. to unban, put a minus before it (e.g. -123456).",
        userBanned: "⛔️ user {{ id }} is banned.",
        userUnbanned: "✅ user {{ id }} is unbanned.",
        userNotFound: "this user hasn't used the bot yet.",
        userInvalid: "the id must be a number.",
        userIsAdmin: "admins can't be banned.",

        maintenanceOn: "🛠 maintenance: on",
        maintenanceOff: "🛠 maintenance: off",
        maintenanceToggled: "maintenance mode is {{ state }}. only admins can use the bot meanwhile.",
        on: "on",
        off: "off",

        caption: "✍️ file caption",
        captionText: "✍️ caption under files\n\ncurrent: {{ current }}\n\nsend the new text, or \"-\" for no caption.",
        captionNone: "(no caption)",
        captionSaved: "✅ caption saved.",

        quota: "🎟 quota",
        quotaText:
            "🎟 daily quota\n\n" +
            "downloads per user per day: {{ daily }}\n" +
            "extra downloads per invite: {{ perInvite }}\n" +
            "vip users (no limit): {{ vip }}",
        quotaUnlimited: "unlimited",
        quotaEditDaily: "✏️ daily quota",
        quotaEditInvite: "✏️ invite reward",
        quotaDailyPrompt: "send how many downloads each user gets per day (0 means unlimited).",
        quotaInvitePrompt: "send how many extra downloads each invite gives (0 means none).",
        quotaSaved: "✅ saved.",
        numberInvalid: "send a number.",

        vip: "⭐️ vip user",
        vipPrompt: "send the user's numeric id to make them vip (no daily quota). to undo, put a minus before it.",
        vipAdded: "⭐️ user {{ id }} is vip now.",
        vipRemoved: "user {{ id }} isn't vip anymore.",

        groupsOn: "👥 groups: on",
        groupsOff: "👥 groups: off",
        groupsToggled: "groups are {{ state }}. in groups, the bot works with /dl link.",

        backup: "💾 backup",
        backupCaption: "💾 fetchr bot backup, {{ date }}\n👥 {{ users }} users",
        backupFailed: "⚠️ couldn't make a backup.",

    },
};

export const LANGUAGES = { fa, en };

// texts for a language code ("fa", "fa-IR", "en", ...)
export const messages = (language) =>
    String(language ?? "").toLowerCase().startsWith("fa") ? fa : en;

// fills {{ name }} placeholders
export const format = (text, values = {}) =>
    String(text).replace(/{{\s*(\w+)\s*}}/g, (_, key) => values[key] ?? "");

// text for an error code from the fetchr api ("error.api.fetch.empty")
export const errorText = (t, code, context = {}) => {
    const key = String(code ?? "").replace(/^error\.api\./, "");

    if (/^(link\.|service\.unsupported)/.test(key)) return t.errors.unsupported;
    if (key === "service.disabled") return t.errors.disabled;
    if (key === "fetch.empty") return t.errors.empty;
    if (key === "content.too_long") return format(t.errors.tooLong, { limit: context.limit ?? "?" });
    if (/private$/.test(key)) return t.errors.private;
    if (/region$/.test(key)) return t.errors.region;
    if (/age$/.test(key)) return t.errors.age;
    if (key === "content.video.live") return t.errors.live;
    if (key === "content.paid") return t.errors.paid;
    if (["rate_exceeded", "fetch.rate", "capacity", "timed_out"].includes(key)) return t.errors.rate;
    if (key.startsWith("auth.")) return t.errors.config;

    return key ? `${t.errors.generic}\n(${key})` : t.errors.generic;
}
