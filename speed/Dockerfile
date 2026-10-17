FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY speed ./speed
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "speed/server.mjs"]
