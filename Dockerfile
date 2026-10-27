FROM node:22-alpine

WORKDIR /app

COPY package.json server.mjs index.html ./
COPY src ./src
COPY styles ./styles
COPY icons ./icons
COPY favicon ./favicon
COPY rules ./rules

RUN mkdir -p /app/data

EXPOSE 8089

ENV PORT=8089

CMD ["node", "server.mjs"]
