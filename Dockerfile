FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate && pnpm install --prod --frozen-lockfile
COPY src ./src
COPY assets/menu ./assets/menu
COPY scripts ./scripts
COPY migrations ./migrations
RUN mkdir -p /app/data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
