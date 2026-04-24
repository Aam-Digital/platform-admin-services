FROM node:24-alpine

USER node

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

RUN npm ci --ignore-scripts --include=dev

COPY --chown=node:node . .

RUN npm run build

RUN npm prune --omit=dev

ENV NODE_ENV="production"

ENV PORT=3000

EXPOSE 3000

CMD [ "node", "dist/src/main.js" ]
