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
  --lambdaArn <lambda-arn> \
```

To deploy to the AWS repo:

```
export AWS_ACCOUNT_ID=<your-account-id>
docker tag cumulus-ecs-task:latest $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/cumulus-ecs-task:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/cumulus-ecs-task:latest

```

To clean up local deployments after repeated builds:

```
npm run docker:clean
```

## Contributing

## License
[Apache-2.0](LICENSE)
