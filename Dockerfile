FROM node:22-alpine AS builder

WORKDIR /app

# Copy server and client package definitions
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install dependencies
RUN cd server && npm ci
RUN cd client && npm ci

# Copy sources
COPY server ./server
COPY client ./client
COPY shared ./shared

# Build client and compile server
RUN cd client && npm run build
RUN cd server && npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000

COPY --from=builder /app/server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 5000

CMD ["node", "server/dist/index.js"]

