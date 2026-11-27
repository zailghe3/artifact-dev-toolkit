FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
ARG ADT_RUNTIME_REVISION=development
WORKDIR /source/adt-runtime
COPY adt-runtime/package.json adt-runtime/package-lock.json adt-runtime/tsconfig.json adt-runtime/release.json ./
RUN npm install -g "$(node -p 'require("./package.json").packageManager')" && npm ci
COPY adt-runtime/src ./src
COPY adt-runtime/scripts/bundle-application.mjs ./scripts/bundle-application.mjs
COPY adt-runtime/application-inputs.json ./application-inputs.json
COPY lib ../lib
COPY tsconfig.json ../tsconfig.json
COPY codex-runner/release.json ../codex-runner/release.json
RUN npm run build && npm prune --omit=dev

FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
ARG ADT_RUNTIME_REVISION=development
ENV NODE_ENV=production ADT_RUNTIME_HOST=0.0.0.0 ADT_RUNTIME_PORT=8080
WORKDIR /runtime
RUN printf '%s' "$ADT_RUNTIME_REVISION" > /runtime/REVISION
COPY --from=build --chown=node:node /source/adt-runtime/package.json ./package.json
COPY --from=build --chown=node:node /source/adt-runtime/node_modules ./node_modules
COPY --from=build --chown=node:node /source/adt-runtime/dist ./dist
COPY --from=build --chown=node:node /source/adt-runtime/release.json ./release.json
COPY --chown=node:node adt-runtime/migrations ./migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node","dist/server.js"]
