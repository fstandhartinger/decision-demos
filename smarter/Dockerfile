FROM node:20-alpine
# eMudhra CA distrust (Oct 2026): current CA bundle, and make Node trust it instead of its bundled root list
RUN apk add --no-cache --upgrade ca-certificates-bundle
ENV NODE_OPTIONS="--use-openssl-ca"
WORKDIR /app
COPY shared ./shared
COPY smarter ./smarter
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "smarter/server.mjs"]
