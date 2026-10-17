FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY smarter ./smarter
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "smarter/server.mjs"]
