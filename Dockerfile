FROM node:14.19.0-alpine3.15

WORKDIR /app

RUN apk update
RUN apk upgrade

COPY package.json /app

RUN set -ex; apk add --no-cache --virtual .fetch-deps curl tar git ;

RUN npm i --production
RUN npm audit fix

COPY app.js /app

COPY config.js /app

COPY db-factory.js /app

COPY http-client.js /app

COPY init.js /app

COPY queue.js /app

COPY service.json /app

COPY api /app/api

ENV IMAGE_TAG=__image_tag__