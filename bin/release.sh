#!/usr/bin/env sh

IMAGE=cumuluss/cumulus-ecs-task
VERSION=$(cat package.json | node_modules/.bin/jsonfilter version | sed -e 's/^"//' -e 's/"$//')
echo $VERSION

docker tag $IMAGE:latest $IMAGE:$VERSION
docker push $IMAGE:$VERSION
