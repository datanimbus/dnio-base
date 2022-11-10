FROM node:18.12.1-alpine3.16
# FROM node:16.17.0-alpine3.16

WORKDIR /tmp/app

RUN apk update
RUN apk upgrade

COPY package.json /tmp/app

RUN set -ex; apk add --no-cache --virtual .fetch-deps curl tar git ;

RUN npm install -g npm
RUN npm install --production --no-audit
# RUN npm audit fix --production
RUN rm -rf /usr/local/lib/node_modules/npm/node_modules/node-gyp/test

COPY app.js /tmp/app

COPY config.js /tmp/app

COPY db-factory.js /tmp/app

COPY http-client.js /tmp/app

COPY init.js /tmp/app

COPY initializeRuntime.js /tmp/app

COPY queue.js /tmp/app

COPY api /tmp/app/api

COPY views /tmp/app/views

COPY codeGen /tmp/app/codeGen

ENV IMAGE_TAG=__image_tag__

ENV NODE_ENV=production

CMD node app.js