# Backend Dockerfile (HTTP version - Debian for better mediasoup compatibility)
# Save as: backend/Dockerfile
# Replace your current backend/Dockerfile with this

FROM node:20-slim

# Install dependencies for mediasoup
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose ports
EXPOSE 3001
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp

# Start the server
CMD ["node", "server.js"]