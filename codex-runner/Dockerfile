# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ARG CODEX_RUNNER_VERSION=development
LABEL org.opencontainers.image.source="https://github.com/zailghe3/artifact-dev-toolkit" \
      org.opencontainers.image.revision="$CODEX_RUNNER_VERSION"
ENV NODE_ENV=production CODEX_HOME=/data/codex PORT=8789 CODEX_RUNNER_VERSION=$CODEX_RUNNER_VERSION
COPY --from=build /build/dist/validate-device-auth-schema.js /tmp/validate-device-auth-schema.js
RUN npm install --global @openai/codex@0.118.0 && \
    node /tmp/validate-device-auth-schema.js codex && rm /tmp/validate-device-auth-schema.js && \
    mkdir -p /data/codex && chown -R node:node /data/codex
WORKDIR /app
COPY --from=build --chown=node:node /build/package.json /build/package-lock.json ./
COPY --from=build --chown=node:node /build/dist ./dist
ENV CODEX_DEVICE_AUTH_COMPATIBLE=1
USER node
VOLUME ["/data/codex"]
EXPOSE 8789
CMD ["node","dist/server.js"]
