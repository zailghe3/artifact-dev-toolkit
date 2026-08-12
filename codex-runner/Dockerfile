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
COPY gai.conf /tmp/gai.conf
COPY --from=build /build/dist/validate-device-auth-schema.js /tmp/validate-device-auth-schema.js
RUN test "$(grep -Ec '^precedence[[:space:]]+' /tmp/gai.conf)" = 5 && \
    grep -Eq '^precedence[[:space:]]+::1/128[[:space:]]+50$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::/0[[:space:]]+40$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+2002::/16[[:space:]]+30$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::/96[[:space:]]+20$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::ffff:0:0/96[[:space:]]+100$' /tmp/gai.conf && \
    ! grep -Eiq 'openai|cloudflare|([0-9]{1,3}\.){3}[0-9]{1,3}' /tmp/gai.conf && \
    install -m 0644 /tmp/gai.conf /etc/gai.conf && rm /tmp/gai.conf && \
    npm install --global @openai/codex@0.147.0 && \
    node /tmp/validate-device-auth-schema.js codex && rm /tmp/validate-device-auth-schema.js && \
    mkdir -p /data/codex && chown -R node:node /data/codex
WORKDIR /app
COPY --from=build --chown=node:node /build/package.json /build/package-lock.json ./
COPY --from=build --chown=node:node /build/dist ./dist
ENV CODEX_DEVICE_AUTH_COMPATIBLE=1 CODEX_RUNNER_ADDRESS_POLICY=ipv4_preferred
USER node
VOLUME ["/data/codex"]
EXPOSE 8789
CMD ["node","dist/server.js"]
