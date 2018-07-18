# cumulus-ecs-task

[![CircleCI](https://circleci.com/gh/nasa/cumulus-ecs-task.svg?style=svg)](https://circleci.com/gh/nasa/cumulus-ecs-task)

Use this Docker image to run a Node.js Lambda function in AWS [ECS](https://aws.amazon.com/ecs/).

## About

cumulus-ecs-task is a Docker image that can run Lambda functions as ECS services.

When included in a Cumulus workflow and deployed to AWS, it will download a specified Lambda function, and act as an activity in a Step Functions workflow.

## Compatibility

This only works with Node.js Lmabda functions, and requires that the Lambda function it is running has a dependency of at least v1.0.1 of [cumulus-message-adapter-js](https://github.com/cumulus-nasa/cumulus-message-adapter-js).

## Usage

Like other Cumulus libraries, cumulus-ecs-task is designed to be deployed to AWS using [kes](https://github.com/developmentseed/kes) to manage Cloudformation config. This documentation assumes you're working with a Cumulus deployment and that you have files and directory stucture similar to what's found in the [cumulus template repository](https://github.com/cumulus-nasa/template-deploy).

Most importantly, we'll need to edit these files:

- lambdas.yml
- workflows.yml
- app/config.yml
- iam/cloudformation.template.yml

### Options

This library has two options:

- `activityArn` **required**
  - The arn of the activity in a step functions workflow. Used to receive messages for that activity and send success/failure responses.
- `lambdaArn` **required**
  - The arn of the lambda function you want to run in ECS.

### lambdas.yml config

There's no config in lambdas.yml that is special to ecs-cumulus-task, just make sure to add the lambda that will be run in ECS. We won't use that lambda directly in workflows.yml, but we will reference the arn of the lambda in workflows.yml.

### workflows.yml config

An example state of a workflow in workflows.yml:

```
EcsTaskHelloWorld:
  CumulusConfig:
    buckets: '{$.meta.buckets}'
    provider: '{$.meta.provider}'
    collection: '{$.meta.collection}'
  Type: Task
  Resource: ${EcsTaskHelloWorldActivity}
  Next: < ... next state in the workflow ... >
```

The important line is `Resource: ${EcsTaskHelloWorldActivity}`.

We'll define that activity in the app/config.yml file.

### ECS cluster configuration

In order for an ECS cluster to be created as a part of your deployment stack, ensure you have the folowing in your `config.yml`:

* An `ecs` config object (detailed in following section)
* vpc.vpcId and vpc.subnets
* iams.instanceProfile

Also ensure if you have specified a VPC and subnet, your subnet is in the same availability zone as `ecs.availabilityZone`.

See [`cumulus-integration-tests/blob/master/app/config.yml`](https://github.com/cumulus-nasa/cumulus-integration-tests/blob/master/app/config.yml) for an example.

### ECS config

This library requires additional configuration to be added to the app/config.yml file under the `ecs` block, as well as a list of activity names under `activities`.

Here's an example deployment configuration that would be placed in app/config.yml:

```yml
yourdeployment:
  # make sure to set these environment variables in the app/.env file
  params:
    - name: DockerPassword
      value: '{{DOCKER_PASSWORD}}'
    - name: DockerEmail
      value: '{{DOCKER_EMAIL}}'
    - name: CmrPassword
      value: '{{CMR_PASSWORD}}'

  # define the ECS activity
  activities:
    - name: EcsTaskHelloWorld

  ecs:
    instanceType: t2.small
    desiredInstances: 1
    availabilityZone: us-east-1a
    amiid: ami-a7a242da
    publicIp: true
    docker: 
      username: <your docker user name>
    services:
      EcsTaskHelloWorld:
        image: cumuluss/cumulus-ecs-task:1.1.1
        cpu: 500
        memory: 500
        count: 0 # increase this to increase the number of tasks
        envs:
          # env vars needed for core cumulus modules:
          internal: <name of internal bucket>
          stackName: <name of deployment (in this case it would be "yourdeployment")>
          AWS_DEFAULT_REGION:
            function: Fn::Sub
            value: '${AWS::Region}'
        commands:
          - cumulus-ecs-task
          - '--activityArn'
          - function: Ref
            value: EcsTaskHelloWorldActivity
          - '--lambdaArn'
          - function: Ref
            value: EcsTaskHelloWorldLambdaFunction
```

Make sure the version on this line:

```
image: cumuluss/cumulus-ecs-task:1.1.1
```

Is the latest version available on [Docker Hub](https://hub.docker.com/r/cumuluss/cumulus-ecs-task/tags/).

Under `activities` we define the activity name `EcsTaskHelloWorld`, which can then be referenced to in the `ecs` section and in workflows.yml as `EcsTaskHelloWorldActivity`.

We can give our service the same name as the activity. Be sure to double-check the options like `cpu`, `memory`, and others to be sure they'll work with your use case.

Note that under the the `commands` section we're referencing the `EcsTaskHelloWorldActivity` as the `activityArn` and the `EcsTaskHelloWorldLambdaFunction` as the `lambdaArn`.

#### Docker credentials

Make sure to set the docker email and password in app/.env:

```
DOCKER_PASSWORD=<your password>
DOCKER_EMAIL=<your email>
```

**Which docker credentials should we use?**

Any valid credentials to authenticate with docker's API service. It's recommended to create an organization-specific docker hub account.

### IAM permissions

The `EcsRole` will need to include permissions to send requests to the step functions API.

The following should be included in the `Statement` of the `EcsRole` policy:

```yml
# Allow state machine interactions
- Effect: Allow
  Action:
  - states:SendTaskFailure
  - states:SendTaskSuccess
  - states:SendTaskHeartbeat
  - states:GetActivityTask
  - states:GetExecutionHistory
  Resource: arn:aws:states:*:*:*
```

## Environment variables

- `AWS_DEFAULT_REGION` – defaults to `us-east-1`

## Development

To run locally:

```
npm start -- --activityArn <your-activity-arn> --lambdaArn <your-lambda-arn>
```

To build the docker image:

```
npm run build
```

To run in Docker locally:

```
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

```
npm start -- --activityArn <your-activity-arn> --lambdaArn <your-lambda-arn>
```

Or with docker:

```
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

```
docker pull cumuluss/cumulus-ecs-task:1.1.1
```

`cat` the ecs config file to make sure credentials are correct:

```
cat /etc/ecs/ecs.config
```

Check if there's multiple entries of the config.

If there is, there are two things to try:

- Delete the ec2 instance and redeploy
- Delete the incorrect config and restart the ecs agent (I haven't tested this much but I expect it to work. You'll still want to update the docker credentials in the deployment's app directory). Restart the agent by doing:
  ```sh
  sudo stop ecs
  source /etc/ecs/ecs.config
  sudo start ecs
  ```

## Create a release

To create a release, first make sure the [CHANGELOG.md](CHANGELOG.md) file is updated with all the changes made.

Next, bump the version and the changes will automatically be released upon merge to master.

```
npm version <major|minor|patch|specific version>
```

Create the build

```
npm run build
```

Release to Docker Hub

```
npm run release
```

## Contributing

See the [CONTRIBUTING.md](CONTRIBUTING.md) file.

## License
[Apache-2.0](LICENSE)
