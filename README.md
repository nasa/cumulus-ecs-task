# cumulus-ecs-task

Use this Docker image to run a Node.js Lambda function in AWS [ECS](https://aws.amazon.com/ecs/).

## Environment variables expected

`AWS_DEFAULT_REGION` – defaults to `us-east-1`

## Useful Commands

To build:

```
npm run docker:build
```

To run locally:

```
./bin/service.js --activityArn <activity-arn> --lambdaArn <lambda-arn>
```

To run in Docker locally:

```
docker run -e AWS_ACCESS_KEY_ID='<aws-access-key>' \
  -e AWS_SECRET_ACCESS_KEY='<aws-secret-key>' \
  cumuluss/cumulus-ecs-task \
  --activityArn <activity-arn> \
  --lambdaArn <lambda-arn>
```

## Create a release

Bump the version

```
npm version <major|minor|patch|specific version>
```

Create the build

```
./bin/build.sh
```

## Contributing

See the [CONTRIBUTING.md](CONTRIBUTING.md) file.

## License
[Apache-2.0](LICENSE)
