FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production

RUN addgroup -S botgroup && adduser -S botuser -G botgroup \
  && mkdir -p /app/data \
  && chown -R botuser:botgroup /app

USER botuser

CMD ["node", "src/index.js"]
