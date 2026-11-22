<div dir="rtl">

# راهنمای نصب fetchr روی سرور

این پوشه همه‌چیز را برای نصب fetchr روی یک VPS دارد: سایت، API، Cloudflare WARP برای یوتیوب، yt-session-generator و ربات تلگرام.
نصب طوری است که **به سایت‌ها و تنظیمات دیگر سرور دست نمی‌زند**.

## چه چیزی کجا نصب می‌شود

```
nginx (روی خود سرور)
 ├─ سایت‌های دیگر شما            ← دست نمی‌خورند
 ├─ fetchr.download              ← فایل‌های سایت در /var/www/fetchr
 └─ api.fetchr.download          ← 127.0.0.1:9000

docker (پوشه‌ی /opt/fetchr)
 ├─ api                          ← فقط روی 127.0.0.1، از بیرون در دسترس نیست
 ├─ yt-session-generator         ← بدون پورت بیرونی
 ├─ warp                         ← پراکسی socks5 فقط برای کانتینرهای دیگر
 └─ bot (اختیاری)                ← ربات تلگرام
```

- اسکریپت نصب فقط دو فایل جدید به nginx اضافه می‌کند (`fetchr-web.conf` و `fetchr-api.conf`). اگر تنظیمات جدید با `nginx -t` خطا بدهد، همان فایل‌ها پاک می‌شوند و nginx اصلاً reload نمی‌شود.
- WARP داخل کانتینر خودش است و فقط ترافیک یوتیوب از آن رد می‌شود. شبکه‌ی سرور و سایت‌های دیگر تغییری نمی‌کنند.
- بدون پرسیدن از شما چیزی نصب نمی‌شود (داکر، nginx، certbot).

## پیش‌نیازها

1. یک VPS با مجازی‌سازی **KVM** و Ubuntu 22.04/24.04 یا Debian 12 (حداقل ۲ هسته و ۲ گیگ RAM).
2. دو رکورد DNS از نوع A که به IP سرور اشاره کنند:
   - `fetchr.download`
   - `api.fetchr.download`
3. پورت‌های ۸۰ و ۴۴۳ در فایروال باز باشند (مثلاً `ufw allow 'Nginx Full'`).

> **اگر دامنه در Cloudflare است:** برای `api.fetchr.download` حالت **DNS only** (ابر خاکستری) را بگذارید. فایل‌ها از API رد می‌شوند و عبور ویدیو از پراکسی رایگان Cloudflare کندتر است و ممکن است با قوانین Cloudflare مشکل داشته باشد. برای `fetchr.download` هر دو حالت مشکلی ندارد. اگر API پشت پراکسی Cloudflare باشد هم IP واقعی کاربران درست تشخیص داده می‌شود.

## نصب

```bash
git clone https://github.com/iprodev/fetchr.git
cd fetchr/deploy
sudo ./install.sh
```

اسکریپت این کارها را انجام می‌دهد و هر جا لازم باشد از شما می‌پرسد:

1. بررسی سرور: داکر، nginx، معتبر بودن تنظیمات فعلی nginx، و وجود `/dev/net/tun` برای WARP.
2. پرسیدن دامنه‌ها و توکن ربات تلگرام (اختیاری)، و ساختن تنظیمات در `/opt/fetchr/.env`.
3. دانلود فایل‌های سایت از آخرین نسخه (release) در گیت‌هاب.
4. اضافه کردن دو دامنه به nginx.
5. اجرای کانتینرها و بررسی اینکه API و WARP کار می‌کنند.
6. گرفتن گواهی رایگان https از Let's Encrypt با certbot.

اگر پورت ۹۰۰۰ قبلاً استفاده شده باشد، اسکریپت خودش یک پورت آزاد دیگر انتخاب می‌کند.

## بررسی بعد از نصب

```bash
cd /opt/fetchr

# وضعیت کانتینرها
sudo docker compose ps

# آیا warp وصل است؟ (باید warp=on ببینید)
sudo docker compose exec warp curl -s --socks5-hostname 127.0.0.1:1080 https://www.cloudflare.com/cdn-cgi/trace | grep warp

# لاگ‌ها
sudo docker compose logs -f api
```

بعد سایت `https://fetchr.download` را باز کنید و یک لینک یوتیوب امتحان کنید.

## ربات تلگرام

1. در تلگرام به [@BotFather](https://t.me/BotFather) پیام دهید، `/newbot` را بزنید و توکن را کپی کنید.
2. فایل `/opt/fetchr/.env` را باز کنید و این دو خط را تنظیم کنید:
   ```
   COMPOSE_PROFILES=bot
   BOT_TOKEN=توکن-ربات
   ```
3. اجرا کنید:
   ```bash
   cd /opt/fetchr && sudo docker compose up -d
   ```

ربات به‌صورت خودکار یک کلید API دارد (در `keys.json`) و محدودیت تعداد درخواست کاربران سایت شامل آن نمی‌شود.

تنظیمات دیگر ربات در `.env`:
- `BOT_VIDEO_QUALITY`: کیفیت ویدیو (پیش‌فرض 720). کیفیت پایین‌تر یعنی فایل‌های کوچک‌تر.
- `BOT_ALLOWED_USERS`: اگر بخواهید فقط افراد خاصی از ربات استفاده کنند، شناسه‌ی عددی تلگرامشان را با کاما جدا کنید.

### ارسال فایل‌های بزرگ‌تر از ۵۰ مگابایت

ربات‌های تلگرام به‌طور عادی فقط تا ۵۰ مگابایت می‌توانند فایل بفرستند. با سرور محلی Bot API این حد به ۲۰۰۰ مگابایت می‌رسد:

1. در [my.telegram.org](https://my.telegram.org) وارد شوید و از بخش API development tools یک `api_id` و `api_hash` بگیرید.
2. یک بار ربات را از سرور اصلی تلگرام خارج کنید (این آدرس را در مرورگر باز کنید):
   `https://api.telegram.org/botتوکن-ربات/logOut`
3. در `.env`:
   ```
   COMPOSE_PROFILES=bot,bot-api-server
   TELEGRAM_API_ID=...
   TELEGRAM_API_HASH=...
   TELEGRAM_API_URL=http://telegram-bot-api:8081
   ```
4. `cd /opt/fetchr && sudo docker compose up -d`

## تنظیمات

همه‌ی تنظیمات در `/opt/fetchr/.env` است. بعد از هر تغییر:

```bash
cd /opt/fetchr && sudo docker compose up -d
```

چند تنظیم مهم:
- `SERVICE_PROXIES`: سرویس‌هایی که از WARP رد می‌شوند. اگر سرویس دیگری هم IP سرور را بلاک کرد، اضافه‌اش کنید:
  `SERVICE_PROXIES=youtube=socks5://warp:1080,instagram=socks5://warp:1080`
- `RATELIMIT_MAX`: حداکثر درخواست هر کاربر در دقیقه.
- `DURATION_LIMIT`: حداکثر طول ویدیو به ثانیه (پیش‌فرض ۳ ساعت).
- `DISABLED_SERVICES`: سرویس‌هایی که نمی‌خواهید کار کنند.
- `WARP_LICENSE_KEY`: اگر WARP+ دارید.

## به‌روزرسانی

```bash
cd fetchr && git pull
cd deploy && sudo ./install.sh
```

اسکریپت تنظیمات و فایل‌های nginx قبلی را نگه می‌دارد، آخرین نسخه‌ی سایت و image‌ها را می‌گیرد و کانتینرها را دوباره اجرا می‌کند.
سه نسخه‌ی آخر سایت در `/var/www/fetchr/releases` می‌ماند.

## مشکلات رایج

**یوتیوب خطا می‌دهد:** اول وصل بودن WARP را بررسی کنید (بالا). اگر یوتیوب IP فعلی WARP را هم بلاک کرده باشد، با ثبت‌نام دوباره IP عوض می‌شود:
```bash
cd /opt/fetchr
sudo docker compose stop warp && sudo rm -rf warp-data/* && sudo docker compose up -d warp
```

**WARP وصل نمی‌شود و در لاگ `open tun` یا `Operation not permitted` می‌بینید:** سرور باید KVM باشد. روی سرورهای OpenVZ/LXC کار نمی‌کند.

**گواهی https گرفته نشد:** مطمئن شوید DNS هر دو دامنه به IP سرور اشاره می‌کند و پورت ۸۰ باز است، بعد:
```bash
sudo certbot --nginx -d fetchr.download -d api.fetchr.download
```

**سایت باز می‌شود ولی لینک‌ها کار نمی‌کنند:** فایل‌های سایت با آدرس API ساخته می‌شوند. اگر دامنه‌ی API چیزی غیر از `api.fetchr.download` است، در گیت‌هاب در Settings ← Secrets and variables ← Actions ← Variables متغیر `WEB_DEFAULT_API` (مثلاً `https://api.example.com/`) و `WEB_HOST` را تنظیم کنید و یک نسخه‌ی جدید منتشر کنید.

## حذف کامل

```bash
cd /opt/fetchr && sudo docker compose --profile '*' down -v
sudo rm -f /etc/nginx/sites-enabled/fetchr-*.conf /etc/nginx/sites-available/fetchr-*.conf
sudo nginx -t && sudo systemctl reload nginx
sudo rm -rf /opt/fetchr /var/www/fetchr
```

## انتشار نسخه‌ی جدید (برای توسعه‌دهنده)

با ساختن یک release در گیت‌هاب با تگی مثل `v1.0.0`:
- image‌های `ghcr.io/iprodev/fetchr` و `ghcr.io/iprodev/fetchr-bot` ساخته می‌شوند (برای amd64 و arm64).
- فایل‌های سایت (`fetchr-web.tar.gz`) ساخته و به release اضافه می‌شوند.

اسکریپت نصب همیشه آخرین release را استفاده می‌کند.

</div>
