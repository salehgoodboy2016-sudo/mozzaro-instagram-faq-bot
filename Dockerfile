FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
