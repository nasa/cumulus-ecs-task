FROM node:14.19.1-alpine

RUN npm install -g npm@latest

RUN apk update && \
  apk add unzip && \
  apk add python3 && \
  ln -s /usr/bin/python3 /usr/bin/python && \
  rm -rf /var/cache/apk

RUN addgroup -S -g 433 service
RUN adduser -S -u 431 -G service -h /home/service -s /sbin/nologin service

WORKDIR /home/service

COPY package.json package-lock.json /home/service/
RUN chown service:service /home/service/package*.json

RUN npm ci --production

COPY . /home/service/
RUN chown -R service:service /home/service

ENTRYPOINT ["node", "./bin/service.js"]
