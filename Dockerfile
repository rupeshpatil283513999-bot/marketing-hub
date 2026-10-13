# Use official Node.js 20 LTS Alpine image for minimal size and security
FROM node:20-alpine AS runner

# Label metadata
LABEL maintainer="Valura.Ai Orbit"
LABEL description="Marketing Hub Automation Server"

# Set working directory
WORKDIR /app

# Set default production environment
ENV NODE_ENV=production
ENV PORT=5173

# Copy package manifests first for efficient layer caching
COPY package*.json ./

# Install production dependencies (if any are declared now or in the future)
RUN if [ -f package.json ]; then npm install --omit=dev; fi

# Copy application files
COPY server.js ./
COPY valura-orbit-logo.png ./
COPY lib/ ./lib/
COPY api/ ./api/
COPY marketing-hub-design/ ./marketing-hub-design/

# Copy initial runtime state data files if present
COPY hub-events.json ./hub-events.json
COPY instagram-leads.json ./instagram-leads.json

# Ensure permissions for the non-root 'node' user
RUN chown -R node:node /app

# Run as non-root user for security
USER node

# Expose server port
EXPOSE 5173

# Healthcheck using native Node.js (no external curl/wget dependencies needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5173) + '/', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "server.js"]
