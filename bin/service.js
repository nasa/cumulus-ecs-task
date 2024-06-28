#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const minimist = require('minimist');
const createCliOptions = require('cliclopts');
const rimraf = require('rimraf');

const Logger = require('../Logger');
const log = new Logger({ sender: 'cumulus-ecs-task/service' });

const {
  runServiceFromActivity,
  runServiceFromSQS,
  runTask
} = require('../index');

const taskDir = path.join(process.cwd(), 'task');
const workDir = path.join(process.cwd(), '.tmp-work');

const cliOptions = createCliOptions([
  {
    name: 'directory',
    abbr: 'd',
    alias: ['taskDirectory'],
    default: taskDir,
    help: 'path to task directory'
  },
  {
    name: 'work-directory',
    abbr: 'w',
    alias: ['workDirectory'],
    default: workDir,
    help: 'path to temporary working directory'
  },
  {
    name: 'lambda-arn',
    abbr: 'l',
    alias: ['lambdaArn'],
    help: 'the arn of the lambda function that will run on ecs'
  },
  {
    name: 'activity-arn',
    abbr: 'a',
    alias: ['activityArn'],
    default: null,
    help: 'the arn of the step function activity for this task'
  },
  {
    name: 'sqs-url',
    alias: ['sqsUrl'],
    default: null,
    help: 'the sqs url used for getting messages for this task'
  },
  {
    name: 'lambda-input',
    alias: ['lambdaInput'],
    default: null,
    help: 'the message input for this task'
  },
  {
    name: 'heartbeat',
    default: null,
    help: 'interval in milliseconds between sending heartbeat messages to the state machine. '
    + 'default is null, which disables the heartbeat'
  },
  {
    name: 'help',
    abbr: 'h',
    help: 'show help',
    boolean: true
  }
]);

const argv = minimist(process.argv.slice(2), cliOptions.options());

if (argv.help) {
  console.log('Usage: command [options]');
  cliOptions.print();
  process.exit(0);
}

log.info('Starting the cumulus-ecs-task runner ...');

rimraf.sync(argv.taskDirectory);
rimraf.sync(argv.workDirectory);

fs.mkdirSync(argv.taskDirectory);
fs.mkdirSync(argv.workDirectory);

// Copies the runtime node_modules to our task directory. This is necessary to make sure
// we get the same depenencies available to us as in the Lambda environment.
fs.cpSync(
  '/var/runtime/node_modules', 
  path.join(argv.taskDirectory, 'node_modules'), 
  { recursive: true }
);

if (argv.activityArn) {
  runServiceFromActivity(argv).catch(console.error);
}
else if (argv.sqsUrl) {
  runServiceFromSQS(argv).catch(console.error);
}
else if (argv.lambdaInput) {
  argv.lambdaInput = JSON.parse(argv.lambdaInput);
  runTask(argv).catch(console.error);
}
else {
  log.error('You must provide one of the following options: activity-arn, sqs-url, lambda-input');
  process.exit(1);
}

process.on('SIGINT', () => {
  log.info('Doing some cleanup work before quitting!');
  rimraf.sync(argv.workDirectory);
  process.exit();
});
