FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

# Zeabur exposes the application web port as 8080.
ENV KOISHI_PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "src/index.js"]
