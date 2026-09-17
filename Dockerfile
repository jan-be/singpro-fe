FROM node:24-alpine AS build-stage
WORKDIR /app

# npm ci needs a package.json, but copying the real one here would tie the
# install to every edit of a script string. That is not hypothetical: adding
# the prerender step changed two scripts and nothing else, and the CI build
# went from 7 seconds to 79, because a miss on this layer makes the runner
# reinstall every dependency and push a fresh node_modules layer to the cache.
# The lockfile already records the root's dependencies verbatim, so the install
# runs against a manifest built from it and is invalidated only when a
# dependency really changes.
COPY package-lock.json ./
RUN node -e "const root = require('./package-lock.json').packages['']; require('fs').writeFileSync('package.json', JSON.stringify(root))" \
    && npm ci

# The real manifest. npm ci normally refuses to run when it disagrees with the
# lockfile, and the install above cannot make that check, so it happens here.
COPY package.json .
RUN node --input-type=commonjs -e "const norm = (o) => Object.entries(o || {}).sort().map((e) => e.join('@')).join(' '); const real = require('./package.json'); const lock = require('./package-lock.json').packages['']; for (const field of ['dependencies', 'devDependencies']) if (norm(real[field]) !== norm(lock[field])) { console.error('package.json ' + field + ' disagrees with package-lock.json; run npm install'); process.exit(1); }"

COPY index.html .
COPY vite.config.js .
COPY public public
COPY src src

RUN npm run build


FROM nginx:alpine

COPY --from=build-stage /app/build/ /files
COPY nginx.conf /etc/nginx/conf.d/default.conf
