# Single-stage build — no compilation step needed for CommonJS Node.js.
# node:20-alpine keeps the image small (~130MB).
FROM node:20-alpine
WORKDIR /app

# Copy manifests first so Docker can cache the npm install layer.
# The layer is only invalidated when package.json or package-lock.json changes,
# not on every source code change.
COPY package*.json ./
RUN npm ci --only=production

# Copy only the source directory, not .env files or uploads/
COPY src/ ./src/

EXPOSE 3001

ENV NODE_ENV=production

# Cloud Run injects PORT; the server already reads process.env.PORT || 3001
CMD ["node", "src/index.js"]
