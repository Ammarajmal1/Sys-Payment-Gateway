# Stage 1: Build Backend & Dashboard
FROM node:24-alpine AS builder
WORKDIR /app

# Copy root dependency definitions
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy backend source
COPY src/ ./src/
COPY docs/ ./docs/
RUN npm run build

# Build Dashboard
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# Stage 2: Production Runner
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend
COPY --from=builder /app/dist ./dist
# Copy built dashboard
COPY --from=builder /app/dashboard/dist ./dashboard/dist

# Create private storage directory
RUN mkdir -p /app/storage/uploads && chmod 700 /app/storage/uploads

EXPOSE 3000

CMD ["node", "dist/src/index.js"]
