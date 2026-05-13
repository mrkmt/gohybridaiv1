# Stage 1: Build
FROM node:20-slim as build

WORKDIR /app

# Copy ONLY package.json (skip lockfile to avoid platform mismatch)
COPY package.json ./

# Install fresh dependencies for Linux
RUN npm install

# Copy source code
COPY . .

# Run build
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
