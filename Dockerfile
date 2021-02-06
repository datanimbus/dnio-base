FROM node:14-alpine

WORKDIR /app

COPY package.json /app

COPY package-lock.json /app

RUN npm i

COPY app.js /app

COPY config.js /app

COPY db-factory.js /app

COPY http-client.js /app

COPY init.js /app

COPY queue.js /app

COPY service.json /app

COPY api /app/api