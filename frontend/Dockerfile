# Stage 1: Build
# Uses a full Node.js image to compile TypeScript, run Next.js build,
# and produce the standalone output bundle.
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Runtime
# Copies only the standalone bundle — no node_modules, no source files.
# This keeps the final image small (~150MB vs ~1GB).
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Next.js standalone output includes a minimal server.js that does not
# need the full node_modules directory — only the files it bundles itself.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

# Cloud Run injects PORT automatically; Next.js standalone respects it.
ENV PORT=3000
CMD ["node", "server.js"]
