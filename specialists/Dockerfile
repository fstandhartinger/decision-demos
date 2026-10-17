FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY specialists ./specialists
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "specialists/server.mjs"]
