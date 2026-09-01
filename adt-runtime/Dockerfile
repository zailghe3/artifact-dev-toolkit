FROM node:24.13.1-alpine AS build
ARG ADT_RUNTIME_REVISION=development
WORKDIR /runtime
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24.13.1-alpine
ARG ADT_RUNTIME_REVISION=development
ENV NODE_ENV=production ADT_RUNTIME_HOST=0.0.0.0 ADT_RUNTIME_PORT=8080
WORKDIR /runtime
RUN printf '%s' "$ADT_RUNTIME_REVISION" > /runtime/REVISION
COPY --from=build --chown=node:node /runtime/package.json ./package.json
COPY --from=build --chown=node:node /runtime/node_modules ./node_modules
COPY --from=build --chown=node:node /runtime/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node","dist/server.js"]
