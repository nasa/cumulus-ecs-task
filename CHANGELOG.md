# cumulus-ecs-task change log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/cumulus-nasa/cumulus-cumulus-ecs-task/compare/v1.0.2...HEAD
[v1.1.1]: https://github.com/cumulus-nasa/cumulus-cumulus-ecs-task/compare/v1.1.0...v1.1.1
[v1.1.0]: https://github.com/cumulus-nasa/cumulus-cumulus-ecs-task/compare/v1.0.2...v1.1.0
[v1.0.2]: https://github.com/cumulus-nasa/cumulus-cumulus-ecs-task/compare/v1.0.1...v1.0.2
[v1.0.1]: https://github.com/cumulus-nasa/cumulus-cumulus-ecs-task/compare/v1.0.0...v1.0.1
[v1.0.0]: https://github.com/cumulus-nasa/cumulus-ecs-task/tree/v1.0.0
