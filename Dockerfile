FROM oven/bun:1-alpine AS build-stage
WORKDIR /app

# Installing is cheap enough (~8s) that the build no longer tries to cache it.
# Caching it meant pulling a 577 MB node_modules layer out of the GitHub Actions
# cache before anything else could run, which cost far more than the install it
# was saving -- see the cache settings in .github/workflows/main.yml.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html .
COPY vite.config.js .
COPY public public
COPY src src

RUN bun run build


# alpine-slim rather than alpine: the difference is the njs and geoip modules
# and the extra entrypoint scripts, none of which this config touches -- it uses
# core http features only. 69 MB against 18.9 MB, which is most of the image.
FROM nginx:alpine-slim

COPY --from=build-stage /app/build/ /files
COPY nginx.conf /etc/nginx/conf.d/default.conf
