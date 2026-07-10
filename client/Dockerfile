# Build context must be the repo root (npm workspaces span client/server/shared):
#   docker build -f client/Dockerfile .
# deps stage is reused by docker-compose.dev.yml (source is bind-mounted there).
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci

FROM deps AS build
COPY shared shared
COPY client client
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
