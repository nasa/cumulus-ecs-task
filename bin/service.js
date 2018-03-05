const fs = require('fs');

const minimist = require('minimist');
const createCliOptions = require('cliclopts');
const rimraf = require('rimraf');

const runService = require('../index');

const dir = path.join(process.cwd(), 'tmp');

var cliOptions = createCliOptions([
  {
    name: 'directory',
    abbr: 'd',
    default: dir,
    help: 'path to temporary directory'
  },
  {
    name: 'event',
    abbr: 'e',
    help: 'JSON string of an AWS Lambda event'
  },
  {
    name: 'context',
    abbr: 'c',
    help: 'JSON string of an AWS Lambda context'
  },
  {
    name: 'lambdaArn',
    abbr: 'l',
    help: 'the arn of the lambda function that will run on ecs'
  },
  {
    name: 'activityArn',
    abbr: 'a',
    help: 'the arn of the step function activity for this task'
  }
]);

var argv = minimist(process.argv.slice(2), cliOptions.options());

rimraf.sync(dir);
fs.mkdirSync(dir);

// get args
// runService(dir, args)
process.on('exit', () => rimraf.sync(dir));
