FROM amazon/aws-lambda-nodejs:20

USER root
RUN dnf install -y unzip shadow-utils

RUN /usr/sbin/groupadd -r service -g 433 
RUN /usr/sbin/useradd -u 431 -r -g service -m -s /sbin/nologin service

RUN chown service:service /opt/

USER service
WORKDIR /home/service

COPY package.json package-lock.json /home/service/
RUN npm ci --production

COPY . /home/service/

ENTRYPOINT ["node", "./bin/service.js"]
