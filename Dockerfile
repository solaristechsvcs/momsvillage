FROM node:22-alpine
WORKDIR /home/node/app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=node:node . .
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 3014
CMD ["node", "server.js"]
