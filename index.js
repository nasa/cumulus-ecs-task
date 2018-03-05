"use strict";
/* eslint-disable no-console */
const https = require('https');
const path = require('path');
const execSync = require('child_process').execSync;
const assert = require('assert');
const EventEmitter = require('events').EventEmitter;

const AWS = require('aws-sdk');
const fs = require('fs');
const rimraf = require('rimraf');

const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
AWS.config.update({ region: region });

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const sf = new AWS.StepFunctions({ apiVersion: '2016-11-23' });

/**
* Download the zip file of a lambda function from AWS
*
* @param {string} arn - the arn of the lambda function
* @param {strind} dir – the dir to download the lambda function to
* @param {function} callback - callback function with `err`, `filepath`, `moduleFileName`,
* and `moduleFunctionName` arguments.
* The `filepath` is the path to the zip file of the lambda function.
* The `moduleFileName` is the filename of the node module.
* The `moduleFunctionName` is the name of the exported function to call in the module.
**/
function getLambdaZip (arn, dir, callback) {
  const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

  lambda.getFunction({ FunctionName: arn }, function (err, data) {
    if (err) return callback(err);

    const codeUrl = data.Code.Location;
    const handlerId = data.Configuration.Handler;
    const moduleFn = handlerId.split('.');
    const moduleFileName = moduleFn[0];
    const moduleFunctionName = moduleFn[1];

    const filepath = path.join(dir, 'fn.zip');
    const file = fs.createWriteStream(filepath);

    file.on('error' callback);
    file.on('finish', () => file.close());
    file.on('close', () => callback(null, filepath, moduleFileName, moduleFunctionName));

    https.get(codeUrl, (res) => res.pipe(file));
  });
}

/**
* Downloads and extracts the code of a lambda function from its zip file
*
* @param {string} arn - the arn of the lambda function
* @param {strind} dir – the dir to download the lambda function to
* @param {function} callback - callback function with `err`, `handler` arguments
* the `handler` is the javascript function that will run in the ECS service
**/
function downloadLambdaHandler (arn, dir, callback) {
  return getLambdaZip(arn, dir, function (err, filepath, moduleFileName, moduleFunctionName) {
    if (err) return callback(err);

    // TODO: consider making the target dir configurable
    execSync('unzip -o ' + filepath + ' -d ./');
    const task = require(`./${moduleFileName}`); //eslint-disable-line global-require
    callback(null, task[moduleFunctionName]);
  })
}

/**
* Polls for work for the given activity arn
*
* @param  {string} activityArn - the lambda activity arn
* @return {object} - eventEmitter emits `data` and `error` events
**/
function pollForWork (activityArn) {
  const emitter = new EventEmitter();

  const interval = setInterval(function () {
    sf.getActivityTask({ activityArn: activityArn }, function (err, data) {
      if (err) return emitter.emit('error', err);
      emitter.emit('data', data);
    });
  }, 500);

  return emitter
}

/**
* Start the Lambda handler as a service
*
* @param {object} options - options object
* @param {string} options.lambdaArn - the arn of the lambda handler
* @param {string} options.activityArn - the arn of the activity
* @param {string} options.directory - the directory to put the lambda zip file in
**/
function runService (options, callback) {
  assert(options && typeof options === 'object', 'options.lambdaArn string is required');
  assert(options.lambdaArn && typeof options.lambdaArn === 'string', 'options.lambdaArn string is required');
  assert(options.activityArn && typeof options.activityArn === 'string', 'options.activityArn string is required');
  assert(options.directory && typeof options.directory === 'string', 'options.directory string is required');

  const lambdaArn = options.lambdaArn;
  const activityArn = options.activityArn;
  const dir = options.directory;

  downloadLambdaHandler(arn, dir, function (err, handler) {
    if (err) return callback(err)

    const work = pollForWork(activityArn);
    work.on('error', callback);

    work.on('data', function (data) {
      console.log('data', data)
      const token = data.token;
      const input = JSON.parse(data.input);
      const event = input.event;
      const context = input.context;

      handler(event, context, function (err, output) {
        if (err) {
          return sf.sendTaskFailure({
            taskToken: token,
            error: err.toString()
          })
        }

        sf.sendTaskSuccess({
          taskToken: token,
          output: output
        });
      });
    });
  });
}

module.exports = runService;
