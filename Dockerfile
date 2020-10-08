ARG RELEASE=3.10
ARG PORT=3000
FROM odp:base.${RELEASE}

WORKDIR /app

COPY . .

EXPOSE ${PORT}

CMD [ "node", "app.js" ]