FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

FROM base AS build
WORKDIR /app
COPY . /app

RUN corepack enable
RUN apk add --no-cache python3 alpine-sdk

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

RUN pnpm deploy --filter=@fetchr/api --prod /prod/api
RUN pnpm deploy --filter=@fetchr/bot --prod /prod/bot

# telegram bot: docker build --target bot .
FROM base AS bot
WORKDIR /app

COPY --from=build --chown=node:node /prod/bot /app

USER node

CMD [ "node", "--disable-warning=ExperimentalWarning", "src/index.js" ]

# yt-dlp for sites the api doesn't support itself: docker build --target ytdlp .
# it updates yt-dlp by itself (see ytdlp/app/server.py), so its files are writable
FROM python:3.13-slim AS ytdlp
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_ROOT_USER_ACTION=ignore \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

RUN useradd --uid 1000 --create-home fetchr \
    && python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --disable-pip-version-check "yt-dlp[default]" \
    && chown -R fetchr:fetchr /opt/venv

# youtube's signatures need a javascript runtime (yt-dlp's default, deno)
COPY --from=denoland/deno:bin-2.5.6 /deno /usr/local/bin/deno

WORKDIR /srv
COPY --chown=fetchr:fetchr ytdlp/app /srv/app

USER fetchr

EXPOSE 4417
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4417/health', timeout=5)"
CMD [ "python", "-m", "app.server" ]

FROM base AS api
WORKDIR /app

COPY --from=build --chown=node:node /prod/api /app
COPY --from=build --chown=node:node /app/.git /app/.git

USER node

EXPOSE 9000
CMD [ "node", "src/fetchr" ]
