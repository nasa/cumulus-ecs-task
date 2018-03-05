FROM centos:6

USER root
RUN yum install -y unzip

COPY . /home/runner

RUN groupadd -r runner -g 433 \
 && useradd -u 431 -r -g runner -d /home/runner -s /sbin/nologin -c "Docker image user" runner \
 && chown -R runner:runner /home/runner

USER runner

RUN curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.32.0/install.sh | bash
ENV NODE_VERSION 6.10.3
RUN . $HOME/.nvm/nvm.sh && nvm install $NODE_VERSION
ENV NVM_PATH $HOME/.nvm/versions/node/v$NODE_VERSION/lib/node
ENV NVM_DIR $HOME/.nvm
ENV PATH /home/runner/.nvm/versions/node/v$NODE_VERSION/bin:$PATH
ENV NVM_BIN $HOME/.nvm/versions/node/v$NODE_VERSION/bin


WORKDIR /home/runner

RUN npm install

ENTRYPOINT [ "node", "--harmony", "bin/service.js" ]
