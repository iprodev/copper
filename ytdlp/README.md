# fetchr-ytdlp

a small http server that looks up links with [yt-dlp](https://github.com/yt-dlp/yt-dlp)
for the api, for sites fetchr doesn't support itself. it doesn't download
anything: the api picks the formats and downloads them through its tunnels.

```
POST /extract  {"url": "https://...", "service": "youtube"}  -> {"ok": true, "info": {...}} or {"ok": false, "error": "..."}
GET  /health                           -> {"ok": true, "version": "<yt-dlp version>"}
```

- only links yt-dlp has a dedicated extractor for are looked up (`unsupported`
  otherwise). yt-dlp's own generic extractor is never used.
- `service` is fetchr's service of the link (`generic` for other sites, the
  default): its proxy from `SERVICE_PROXIES` (the same as the api's) is used,
  so the files work for the address the api downloads them from.
- youtube needs a javascript runtime: the image has deno.
- every connection is checked: only public addresses are allowed, redirects
  and dns answers included (`app/guard.py`).
- each lookup runs in its own process, a few at a time, and is killed when it
  takes too long.
- it updates yt-dlp by itself once a day and restarts to use it.

settings (environment variables): `YTDLP_PORT` (4417), `YTDLP_WORKERS` (2),
`YTDLP_TIMEOUT` (30), `YTDLP_QUEUE_WAIT` (10), `YTDLP_UPDATE_HOURS` (24, 0 turns
it off), `YTDLP_DISABLED_EXTRACTORS`, `SERVICE_PROXIES`, `YTDLP_PROXY`. see
`docs/api-env-variables.md#ytdlp_url` and `deploy/docker-compose.yml`.

```sh
# image
docker build --target ytdlp -t fetchr-ytdlp .

# development
pip install "yt-dlp[default]"
cd ytdlp
python -m app.server
python -m unittest discover -s tests -t . -v
```
