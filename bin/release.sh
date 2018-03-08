#!/usr/bin/env bash

IMAGE=cumuluss/cumulus-ecs-task
VERSION=$(cat package.json | node_modules/.bin/jsonfilter version | sed -e 's/^"//' -e 's/"$//')
PREVIOUS_VERSION=$(npm view @cumulus/cumulus-ecs-task version)

set -o pipefail

if [ "$VERSION" = "$PREVIOUS_VERSION" ]; then
  echo "$VERSION already released"
  exit 0
fi

if [ "$VERSION" != "$PREVIOUS_VERSION" ]; then
  npm publish --access public
  docker build -t cumuluss/cumulus-ecs-task .
  docker login -u cumulususer -p $DOCKER_PASSWORD
  docker tag $IMAGE:latest $IMAGE:$VERSION
  docker push $IMAGE:$VERSION
fi
