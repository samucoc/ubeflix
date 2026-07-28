FROM node:20-alpine

RUN apk update && apk add --no-cache --force-overwrite ffmpeg p7zip python3 py3-pip
RUN pip3 install --break-system-packages spotdl yt-dlp --upgrade

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
