FROM node:16-alpine as build-stage
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src src
COPY public public

RUN npm run build


FROM nginx:alpine

COPY --from=build-stage /app/build/ /files
COPY nginx.conf /etc/nginx/conf.d/default.conf
