FROM node:20-alpine AS base

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8633

COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

COPY . .

EXPOSE 8633

CMD ["node", "./bin/www"]

