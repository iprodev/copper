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

CMD [ "node", "src/index.js" ]

FROM base AS api
WORKDIR /app

COPY --from=build --chown=node:node /prod/api /app
COPY --from=build --chown=node:node /app/.git /app/.git

USER node

EXPOSE 9000
CMD [ "node", "src/fetchr" ]
