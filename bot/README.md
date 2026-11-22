# fetchr telegram bot

send a link to the bot, get the file back in telegram.
the bot talks to a fetchr api instance, so every service supported by the instance works.

- works in private chats, in persian and english. new users pick a language, then get a welcome message and a keyboard with help, settings and language.
- after a link is sent, the user picks a quality (1080p, 720p, 480p, 360p or audio only) with buttons. a default quality can be set in /settings.
- several photos/videos are sent as albums.
- admin panel (/admin, for `ADMIN_IDS`): stats, broadcasts to all users, required channels (users must join them first), editable welcome messages, banning users and a maintenance mode.
- links are never stored or logged. the bot keeps users' telegram ids, languages and settings (needed for broadcasts) and daily download counts per service in a small sqlite database.
- files are kept in a temporary folder only while they're being sent.
- no dependencies besides node.js (22.13 or newer).

## running
the bot uses long polling, so it doesn't need a public address or a domain.

1. create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. run it next to your fetchr api (see `deploy/` for a docker compose setup):
   ```sh
   BOT_TOKEN=123:abc FETCHR_API_URL=http://localhost:9000/ node src/index.js
   ```
   or with docker: `docker build --target bot -t fetchr-bot .` in the repository root.

## environment variables
| name | default | description |
|:--|:--|:--|
| `BOT_TOKEN` | | **required.** token from @BotFather. |
| `FETCHR_API_URL` | `http://localhost:9000/` | address of the fetchr api, ideally the internal one (e.g. `http://fetchr-api:9000/` in docker). tunnels are fetched through it too. |
| `FETCHR_API_KEY` | | api key, if the instance uses [api keys](../docs/protect-an-instance.md). recommended, so the bot gets its own rate limit. |
| `TELEGRAM_API_URL` | `https://api.telegram.org` | a [local bot api server](https://github.com/tdlib/telegram-bot-api). with it, files up to 2000 MB can be sent instead of 50 MB. |
| `MAX_FILE_SIZE_MB` | `50`, or `2000` with a local bot api server | bigger files are refused. |
| `VIDEO_QUALITY` | `720` | video quality used when none is picked: `max`, `2160`, `1440`, `1080`, `720`, `480`, `360`, `240` or `144`. |
| `CONCURRENCY` | `3` | how many links are processed at the same time. |
| `USER_RATE_LIMIT` | `10` | links per user per minute. |
| `ADMIN_IDS` | | comma-separated telegram user ids of admins. they can open the admin panel with /admin. your id can be found with bots like @userinfobot. |
| `DATA_DIR` | `data` | where the database (`bot.db`) is kept. |
| `TEMP_DIR` | system temp folder | where files are kept while they're being sent. |

## admin panel
send /admin to the bot from an account listed in `ADMIN_IDS`:
- **stats**: users (active, blocked the bot, banned, new), downloads today / this week / in total, top services.
- **broadcast**: send any message (text, media, a forwarded post), check the preview and confirm. it's copied to every user who hasn't blocked the bot, at about 25 messages per second. users who blocked the bot are skipped from then on.
- **required channels**: add channels by username, link or a forwarded post. the bot must be an admin in them. users have to join all of them before using the bot (admins don't).
- **welcome message**: a custom welcome message for each language, or the default one.
- **ban a user**: by numeric id (`-id` unbans).
- **maintenance**: only admins can use the bot while it's on.

## rate limits of the api
all requests of the bot come from the same address. without an api key, they share the api's per-ip limits
(`RATELIMIT_MAX` and `TUNNEL_RATELIMIT_MAX`), which are meant for a single person.
give the bot an api key with a higher limit, and raise `TUNNEL_RATELIMIT_MAX` if many people use it.

## tests
```sh
pnpm run --prefix bot test
```
