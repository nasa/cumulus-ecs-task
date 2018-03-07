#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const minimist = require('minimist');
const createCliOptions = require('cliclopts');
const rimraf = require('rimraf');

const runService = require('../index');

const taskDir = path.join(process.cwd(), 'task');
const workDir = path.join(process.cwd(), '.tmp-work');

var cliOptions = createCliOptions([
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
    help: 'the arn of the step function activity for this task'
  }
]);

var argv = minimist(process.argv.slice(2), cliOptions.options());

rimraf.sync(argv.taskDirectory);
rimraf.sync(argv.workDirectory);

fs.mkdirSync(argv.taskDirectory);
fs.mkdirSync(argv.workDirectory);

runService(argv, function (err) {
  if (err) {
    console.log(err);
    process.exit(1);
  }
});

process.on('exit', () => rimraf.sync(argv.workDirectory));
