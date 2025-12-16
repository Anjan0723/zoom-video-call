# Frontend Dockerfile (HTTPS Production Ready)
# Save as: frontend/Dockerfile

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application files
COPY . .

# Build the application
RUN npm run build

# Production stage with Nginx
FROM nginx:alpine

# Install openssl for self-signed certificates
RUN apk add --no-cache openssl

# Create directory for SSL certificates
RUN mkdir -p /etc/nginx/ssl

# Generate self-signed certificate (for development)
# This will be overridden by volume mount in production
RUN openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/nginx.key \
    -out /etc/nginx/ssl/nginx.crt \
    -subj "/C=IN/ST=Karnataka/L=Bengaluru/O=VideoConf/CN=localhost"

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTPS and HTTP ports
EXPOSE 443 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider https://localhost:443/ --no-check-certificate || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]