FROM node:14-alpine

WORKDIR /app

COPY package.json /app

RUN npm i --production

COPY app.js /app

COPY config.js /app

COPY db-factory.js /app

COPY http-client.js /app

COPY init.js /app

COPY queue.js /app

COPY service.json /app

COPY api /app/api

ENV IMAGE_TAG=__image_tag__