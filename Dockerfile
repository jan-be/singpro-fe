FROM node:24-alpine AS build-stage
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html .
COPY vite.config.js .
COPY public public
COPY src src

RUN npm run build


FROM nginx:alpine

COPY --from=build-stage /app/build/ /files
COPY nginx.conf /etc/nginx/conf.d/default.conf
