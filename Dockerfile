FROM node:22-alpine

WORKDIR /app

COPY server.mjs index.html ./
COPY src ./src
COPY styles ./styles
COPY icons ./icons
COPY favicon ./favicon
COPY geo ./geo

RUN mkdir -p /app/data

EXPOSE 8089

ENV PORT=8089

CMD ["node", "server.mjs"]
