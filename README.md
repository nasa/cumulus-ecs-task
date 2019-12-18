# cumulus-ecs-task

[![CircleCI](https://circleci.com/gh/nasa/cumulus-ecs-task.svg?style=svg)](https://circleci.com/gh/nasa/cumulus-ecs-task)
[![npm version](https://badge.fury.io/js/%40cumulus%2Fcumulus-ecs-task.svg)](https://badge.fury.io/js/%40cumulus%2Fcumulus-ecs-task)

Use this Docker image to run a Node.js Lambda function in AWS [ECS](https://aws.amazon.com/ecs/).

## About

cumulus-ecs-task is a Docker image that can run Lambda functions as ECS services.

When included in a Cumulus workflow and deployed to AWS, it will download a specified Lambda function, and act as an activity in a Step Functions workflow.

## Compatibility

This only works with Node.js Lambda functions, and requires that the Lambda function it is running has a dependency of at least v1.0.1 of [cumulus-message-adapter-js](https://github.com/cumulus-nasa/cumulus-message-adapter-js).

## Usage

Like other Cumulus libraries, cumulus-ecs-task is designed to be deployed to AWS using [kes](https://github.com/developmentseed/kes) to manage Cloudformation config. This documentation assumes you're working with a Cumulus deployment and that you have files and directory structure similar to what's found in the [cumulus template repository](https://github.com/cumulus-nasa/template-deploy).

### Options

This library has two options:

- `activityArn` **required**
  - The arn of the activity in a step functions workflow. Used to receive messages for that activity and send success/failure responses.
- `lambdaArn` **required**
  - The arn of the lambda function you want to run in ECS.

### Workflow config

For examples of how to integrate this image with Cumulus, please see the [documentation](https://nasa.github.io/cumulus/docs/workflows/developing-workflow-tasks#ecs-activities) and our [example workflow](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ecs_hello_world_workflow.tf) in source.

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

You can execute workflows on AWS that test the version of cumulus-ecs-task that you're developing on locally.

First, make sure that the ECS cluster for your deployment has zero tasks running that might respond to a workflow's requests.

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

Finally, trigger a workflow. You can do this from the Cumulus dashboard, the Cumulus API, or with the AWS Console by supplying a

## Troubleshooting

SSH into the ECS container instance.

Make sure the EC2 instance has internet access and is able to pull the image from docker hub by doing:

```bash
docker pull cumuluss/cumulus-ecs-task:1.1.1
```

`cat` the ecs config file to make sure credentials are correct:

```bash
cat /etc/ecs/ecs.config
```

Check if there's multiple entries of the config.

If there is, there are two things to try:

- Delete the ec2 instance and redeploy
- Delete the incorrect config and restart the ecs agent (I haven't tested this much but I expect it to work. You'll still want to update the docker credentials in the deployment's app directory). Restart the agent by doing:

```bash
sudo stop ecs
source /etc/ecs/ecs.config
sudo start ecs
```

## Create a release

To create a release, first make sure the [CHANGELOG.md](CHANGELOG.md) file is updated with all the changes made.

Next, bump the version and the changes will automatically be released upon merge to master.

```bash
npm version <major|minor|patch|specific version>
```

Create the build

```bash
npm run build
```

Release to Docker Hub

```bash
npm run release
```

## Contributing

See the [CONTRIBUTING.md](CONTRIBUTING.md) file.

## License

[Apache-2.0](LICENSE)
