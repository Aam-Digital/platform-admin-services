FROM node:22-alpine

USER node

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

ENV NODE_ENV="production"

RUN npm ci --ignore-scripts

COPY --chown=node:node . .

RUN npm run build

ENV PORT=3000

EXPOSE 3000

CMD [ "node", "dist/main.js" ]
