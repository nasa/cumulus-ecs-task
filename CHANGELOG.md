# cumulus-ecs-task change log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [v.1.6.0]

## BREAKING CHANGES

- **CUMULUS-1896** - Updates to the cma-js library and Cumulus core required an update to this image to utilize Async handlers.  See [node.js lambda documentation](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html) for more on this.   Users utilizing this module should update their lambdas to utilize an async handler style.


## [v1.5.1]

### Fixed

- Fixed python linking issue due to alpine python version update.

## [v1.5.0]

** This release is broken, all users should update to v1.5.1

### BREAKING CHANGES

- **CUMULUS-1629**
  - Update image python to python3.   This version of cumulus-ecs-task is *required* for [Cumulus message adapter](https://github.com/nasa/cumulus-message-adapter) >= 1.2.0.

## [v1.4.0]

### Changed

- **CUMULUS-1626**

  - Updated node runtime to 10.16.x for cumulus-ecs-task

## [v1.3.0]

### Added
- **CUMULUS-1418**
  - Added ability to use lambda layers if they are configured for the target lambda
  - Added logic to allow CMA to utilize default `cumulus-message-adapter` location, else expect it in /opt/

## [v1.2.5]

### Fixed
- **CUMULUS-802** - Stop polling for new work if a SIGTERM is received

## [v1.2.4]

### Fixed
- **CUMULUS-953** - The lambdaArn parameter will accept a Lambda ARN or a Lambda
  function name.

## [v1.2.3]

### Fixed
- **CUMULUS-933**
  - Fixed additional cases where logs were being written without a sender field.
  - Moved logging to a Logger class

## [v1.2.2]

### Fixed
- **CUMULUS-933** - Add a sender field to logs

## [v1.2.1]

### Fixed
- **CUMULUS-937** - If a connection timeout is received when trying to download
  the lambda function's zip file from S3, the download will be retried.

## [v1.2.0]

### Added
- Support for running a single lambda task
- Support for running tasks from messages in SQS
- Unit tests for the library
- the CLI supports new flags:
  - `--help` for returning CLI options
  - `--sqs-url` for reading message from the queue
  - `--lambda-input` for running one task

### Changed
- The internal implementation of Step Function Activity polling changed
  - The functions updated to use promises instead of callbacks
  - The TaskPoll class replaced with a simple function

### Fixed
- improved logging

## [v1.1.2] - 2018-06-05
### Fixed
- **CUMULUS-602** - Format all logs sent to Elastic Search.
  - Format the error message.

## [v1.1.1] - 2018-04-23
### Fixed
- Fix a bug where the ecs task did not start correctly [CUMULUS-519]

## [v1.1.0] - 2018-04-12
- Upgrade node version to node 8.11

## [v1.0.2] - 2018-03-30
- increase activity queue timeout to 65 seconds as suggested here: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#getActivityTask-property

## [v1.0.1] - 2018-03-23
- fixes the validation error that happens when error strings are too long for stepfunctions.sendTaskFailure()

## [v1.0.0] - 2018-03-08

### Added
- Initial release
[Unreleased]: https://github.com/nasa/cumulus-ecs-task/compare/v1.5.0...HEAD
[v1.5.0]: https://github.com/nasa/cumulus-ecs-task/compare/v1.4.0...v1.5.0
[v1.4.0]: https://github.com/nasa/cumulus-ecs-task/compare/v1.3.0...v1.4.0
[v1.3.0]: https://github.com/nasa/cumulus-ecs-task/compare/v1.2.5...v1.3.0
[v1.2.5]: https://github.com/nasa/cumulus-ecs-task/compare/v1.2.4...v1.2.5
[v1.1.2]: https://github.com/nasa/cumulus-ecs-task/compare/v1.1.2...v1.2.0
[v1.1.2]: https://github.com/nasa/cumulus-ecs-task/compare/v1.1.1...v1.1.2
[v1.1.1]: https://github.com/nasa/cumulus-ecs-task/compare/v1.1.0...v1.1.1
[v1.1.0]: https://github.com/nasa/cumulus-ecs-task/compare/v1.0.2...v1.1.0
[v1.0.2]: https://github.com/nasa/cumulus-ecs-task/compare/v1.0.1...v1.0.2
[v1.0.1]: https://github.com/nasa/cumulus-ecs-task/compare/v1.0.0...v1.0.1
[v1.0.0]: https://github.com/nasa/cumulus-ecs-task/tree/v1.0.0
