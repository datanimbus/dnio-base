ARG RELEASE=3.10
ARG PORT=3000
FROM data.stack:base.${RELEASE}

WORKDIR /app

COPY . .

EXPOSE ${PORT}

CMD [ "node", "app.js" ]