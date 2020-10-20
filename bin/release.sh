#!/bin/bash

set -ex

IMAGE=cumuluss/cumulus-ecs-task
export VERSION_NUMBER=$(jq --raw-output .version package.json)
export VERSION_TAG="v$VERSION_NUMBER"
export LATEST_TAG=$(curl -H \
  "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/nasa/cumulus-ecs-task/tags | jq --raw-output '.[0].name')

if [ "$VERSION_TAG" != "$LATEST_TAG" ]; then
  echo "tag does not exist for version $VERSION_TAG, creating tag"

  # create git tag
  git tag -a "$VERSION_TAG" -m "$VERSION_TAG" || echo "$VERSION_TAG already exists"
  git push origin "$VERSION_TAG"
fi

export RELEASE_URL=$(curl -H \
  "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/nasa/cumulus-ecs-task/releases/tags/$VERSION_TAG | jq --raw-output '.url // ""')

if [ -z "$RELEASE_URL" ]; then
  echo "release does not exist"

  curl -H \
    "Authorization: token $GITHUB_TOKEN" \
    -d "{\"tag_name\": \"$VERSION_TAG\", \"name\": \"$VERSION_TAG\", \"body\": \"Release $VERSION_TAG\" }"\
    -H "Content-Type: application/json"\
    -X POST \
    https://api.github.com/repos/nasa/cumulus-ecs-task/releases
fi

# Necessary for "docker manifest inspect"
export DOCKER_CLI_EXPERIMENTAL=enabled

if ! docker manifest inspect $IMAGE:$VERSION_NUMBER &> /dev/null; then
  echo "Docker image $IMAGE:$VERSION_NUMBER does not exist, publishing"
  docker login -u cumulususer -p $DOCKER_PASSWORD
  docker tag $IMAGE:latest $IMAGE:$VERSION_NUMBER
  docker push $IMAGE:$VERSION_NUMBER
else
  echo "Docker image $IMAGE:$VERSION_NUMBER already exists"
fi
