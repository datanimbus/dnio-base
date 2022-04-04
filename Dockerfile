FROM node:14-alpine

WORKDIR /app

COPY package.json /app

RUN set -ex; apk add --no-cache --virtual .fetch-deps curl tar git ;

RUN npm i --production

COPY app.js /app

COPY config.js /app

COPY db-factory.js /app

COPY http-client.js /app

COPY init.js /app

COPY initializeRuntime.js /app

COPY queue.js /app

COPY api /app/api

COPY codeGen /app/codeGen

ENV IMAGE_TAG=__image_tag__

ENV NODE_ENV=production

CMD node app.js