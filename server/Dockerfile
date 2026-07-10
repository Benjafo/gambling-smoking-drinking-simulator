# Build context must be the repo root (npm workspaces span client/server/shared):
#   docker build -f server/Dockerfile .
FROM node:22-alpine

WORKDIR /app

# Only the manifests are needed to resolve the workspace + lockfile.
COPY package.json package-lock.json tsconfig.base.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci

# server/src runs straight through tsx (no compile step), same as `npm run server` locally.
COPY shared shared
COPY server server

ENV PORT=8081
EXPOSE 8081

CMD ["npm", "run", "server"]
