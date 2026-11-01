FROM node:22-alpine
WORKDIR /home/node/app
COPY . .
RUN npm install --omit=dev --no-audit --no-fund
RUN mkdir -p uploads
RUN chown -R node:node /home/node/app
USER node
EXPOSE 3014
CMD ["node", "server.js"]
