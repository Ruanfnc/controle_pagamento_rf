FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo DATA_DIR=/data
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
