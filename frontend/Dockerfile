# Frontend: Vite React dev server
# This Dockerfile is for LOCAL DEVELOPMENT (hot reload via volume mount).
# For production, use a separate multi-stage build that runs `vite build`
# and serves the static output through nginx, or deploy to a static host
# like Vercel or Netlify instead of Docker at all.

FROM node:20-slim

WORKDIR /app

COPY package.json .
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
