FROM node:8.10.0

RUN apt-get update && apt-get install -y unzip

RUN npm install -g npm@latest

RUN groupadd -r service -g 433
RUN useradd -u 431 -r -g service -d /home/service -s /sbin/nologin -c "Docker image user" service

WORKDIR /home/service

COPY package.json package-lock.json /home/service/
RUN chown -R service:service /home/service

RUN npm ci

COPY . /home/service
RUN chown -R service:service /home/service

ENTRYPOINT ["node", "./bin/service.js"]
