FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Expose ports
EXPOSE 3001 4173

# Start both API server and preview server
CMD sh -c "npx tsx server/index.ts & npx vite preview --host --port 4173 && wait"
