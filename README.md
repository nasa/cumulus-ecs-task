# cumulus-ecs-task

[![CircleCI](https://circleci.com/gh/nasa/cumulus-ecs-task.svg?style=svg)](https://circleci.com/gh/nasa/cumulus-ecs-task)
[![npm version](https://badge.fury.io/js/%40cumulus%2Fcumulus-ecs-task.svg)](https://badge.fury.io/js/%40cumulus%2Fcumulus-ecs-task)

Use this Docker image to run a Node.js Lambda function in AWS
[ECS](https://aws.amazon.com/ecs/).

## About

cumulus-ecs-task is a Docker image that can run Lambda functions as ECS
services.

When included in a Cumulus workflow and deployed to AWS, it will download a
specified Lambda function, and act as an activity in a Step Functions workflow.

## Compatibility

This only works with Node.js Lambda functions, and requires that the Lambda
function it is running has a dependency of at least v1.0.1 of
[cumulus-message-adapter-js](https://github.com/cumulus-nasa/cumulus-message-adapter-js).

## Usage

Like other Cumulus libraries, cumulus-ecs-task is designed to be deployed to AWS
using [kes](https://github.com/developmentseed/kes) to manage Cloudformation
config. This documentation assumes you're working with a Cumulus deployment and
that you have files and directory structure similar to what's found in the
[cumulus template repository](https://github.com/cumulus-nasa/template-deploy).

### Options

This library has two options:

- `activityArn` **required**
  - The arn of the activity in a step functions workflow. Used to receive
    messages for that activity and send success/failure responses.
- `lambdaArn` **required**
  - The arn of the lambda function you want to run in ECS.

### Workflow config

For examples of how to integrate this image with Cumulus, please see the
[documentation](https://nasa.github.io/cumulus/docs/workflows/developing-workflow-tasks#ecs-activities)
and our
[example workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ecs_hello_world_workflow.tf)
in source.

## Development

To run locally:

```bash
npm start -- --activityArn <your-activity-arn> --lambdaArn <your-lambda-arn>
```

To build the docker image:

```bash
npm run build
```

To run in Docker locally:

```bash
docker run -e AWS_ACCESS_KEY_ID='<aws-access-key>' \
  -e AWS_SECRET_ACCESS_KEY='<aws-secret-key>' \
  cumuluss/cumulus-ecs-task \
  --activityArn <your-activity-arn> \
  --lambdaArn <your-lambda-arn>
```

### To test a workflow while developing locally

You can execute workflows on AWS that test the version of cumulus-ecs-task that
you're developing on locally.

First, make sure that the ECS cluster for your deployment has zero tasks running
that might respond to a workflow's requests.

That way only your local version will respond to your workflow.

Next, start ecs-cumulus-task locally.

Either with node:

```bash
npm start -- --activityArn <your-activity-arn> --lambdaArn <your-lambda-arn>
```

Or with docker:

```bash
# build the image
npm run build

# run the image
docker run -e AWS_ACCESS_KEY_ID='<aws-access-key>' \
  -e AWS_SECRET_ACCESS_KEY='<aws-secret-key>' \
  cumuluss/cumulus-ecs-task \
  --activityArn <your-activity-arn> \
  --lambdaArn <your-lambda-arn>
```

Finally, trigger a workflow. You can do this from the Cumulus dashboard, the
Cumulus API, or with the AWS Console.

## Troubleshooting

SSH into the ECS container instance.

Make sure the EC2 instance has internet access and is able to pull the image
from docker hub by doing:

```bash
docker pull cumuluss/cumulus-ecs-task:1.9.0
```

`cat` the ecs config file to make sure credentials are correct:

```bash
cat /etc/ecs/ecs.config
```

Check if there's multiple entries of the config.

If there is, there are two things to try:

- Delete the ec2 instance and redeploy
- Delete the incorrect config and restart the ecs agent (I haven't tested this
  much but I expect it to work. You'll still want to update the docker
  credentials in the deployment's app directory). Restart the agent by doing:

```bash
sudo stop ecs
source /etc/ecs/ecs.config
sudo start ecs
```

## Create a release

### 1. Create a branch for the new release

#### From Master

Create a branch titled `release-MAJOR.MINOR.PATCH` for the release.

```shell
    git checkout -b release-MAJOR.MINOR.PATCH

e.g.:
    git checkout -b release-1.1.0
```

### 2. Update the version number

```bash
npm version <major|minor|patch|specific version> --no-git-tag-version
```

### 3. Update CHANGELOG.md

Update the `CHANGELOG.md`. Put a header under the `Unreleased` section with the new version number and the date.

Add a link reference for the github "compare" view at the bottom of the `CHANGELOG.md`, following the existing pattern.
This link reference should create a link in the CHANGELOG's release header to changes in the corresponding release.

Commit and push these changes.

### 4. Create a pull request against master

### 5. Create a git tag for the release

Create and push a new git tag:

```bash
    git tag -a vMAJOR.MINOR.PATCH -m "Release MAJOR.MINOR.PATCH"
    git push origin vMAJOR.MINOR.PATCH

e.g.:
    git tag -a v1.1.0 -m "Release 1.1.0"
    git push origin v1.1.0
```

Upon the PR is merged to master, the npm package and docker image will be automatically published.

## Contributing

See the [CONTRIBUTING.md](CONTRIBUTING.md) file.

## License

[Apache-2.0](LICENSE)
