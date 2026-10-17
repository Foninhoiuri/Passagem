FROM node:24-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-alpine3.23
RUN apk add --no-cache heif-thumbnailer util-linux-misc poppler-utils font-dejavu
WORKDIR /app
ARG APP_VERSION=development
ENV NODE_ENV=production DATA_DIR=/data APP_VERSION=${APP_VERSION}
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ server/
COPY --from=web /web/dist web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
