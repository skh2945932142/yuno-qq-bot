FROM node:22-alpine

RUN apk add --no-cache ffmpeg g++ make python3

WORKDIR /app

# Zeabur exposes the application web port as 8080.
ENV KOISHI_PORT=8080

# Reuse the headers bundled in the Node image instead of downloading them during node-gyp builds.
ENV npm_config_nodedir=/usr/local

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "src/index.js"]
