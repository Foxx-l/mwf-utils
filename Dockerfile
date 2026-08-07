FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

RUN addgroup -S botgroup && adduser -S botuser -G botgroup \
  && mkdir -p /app/data \
  && chown -R botuser:botgroup /app

USER botuser

CMD ["node", "src/index.js"]
