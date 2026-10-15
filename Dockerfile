# CouchVerse: single container serving the API, sockets and the built client.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY client/package*.json ./client/
RUN npm ci && npm --prefix client ci
COPY . .
ARG SITE_ORIGIN=http://localhost:4000
ENV SITE_ORIGIN=$SITE_ORIGIN
RUN npm run build && npm run fetch-samples && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/extension/dist ./extension/dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 4000
ENV PORT=4000
CMD ["node", "server/index.js"]
