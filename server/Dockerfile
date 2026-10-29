FROM node:22-alpine AS builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app/server
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true
ENV HOST=0.0.0.0
ENV PORT=4000
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/server/dist ./dist
COPY db/migrations /app/db/migrations
EXPOSE 4000
CMD ["node", "dist/index.js"]
