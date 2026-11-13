FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN mkdir -p /app/datos/bancos && chown -R node:node /app/datos

USER node
EXPOSE 8124
CMD ["node", "--watch", "server/servidor.js"]
