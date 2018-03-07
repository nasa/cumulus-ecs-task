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
* @param {strind} workDir – the dir to download the lambda function to
* @param {function} callback - callback function with `err`, `filepath`, `moduleFileName`,
* and `moduleFunctionName` arguments.
* The `filepath` is the path to the zip file of the lambda function.
* The `moduleFileName` is the filename of the node module.
* The `moduleFunctionName` is the name of the exported function to call in the module.
**/
function getLambdaZip (arn, workDir, callback) {
  const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

  lambda.getFunction({ FunctionName: arn }, function (err, data) {
    if (err) return callback(err);

    const codeUrl = data.Code.Location;
    const handlerId = data.Configuration.Handler;
    const moduleFn = handlerId.split('.');
    const moduleFileName = moduleFn[0];
    const moduleFunctionName = moduleFn[1];

    const filepath = path.join(workDir, 'fn.zip');
    const file = fs.createWriteStream(filepath);

    file.on('error', callback);
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
function downloadLambdaHandler (arn, workDir, taskDir, callback) {
  return getLambdaZip(arn, workDir, function (err, filepath, moduleFileName, moduleFunctionName) {
    if (err) return callback(err);
  
    execSync(`unzip -o ${filepath} -d ${taskDir}`);
    const task = require(`${taskDir}/${moduleFileName}`); //eslint-disable-line global-require
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
      console.log('getActivityTask response', err, data)
      if (err) return emitter.emit('error', err);
      emitter.emit('data', data);
    });
  }, 500);

  return emitter
}

/**
* Starts heartbeat to indicate worker is working on the task
*
* @param  {string} token - the task token
**/
function startHeartbeat (token) {
  return setInterval(function () {
    sf.sendTaskHeartbeat({ taskToken: token }, function (err, data) {
      if (err) {
        console.log('error sending heartbeat', err);
      }
    }, 60000);
  });
}

/**
* Start the Lambda handler as a service
*
* @param {object} options - options object
* @param {string} options.lambdaArn - the arn of the lambda handler
* @param {string} options.activityArn - the arn of the activity
* @param {string} options.taskDirectory - the directory to put the unzipped lambda zip
* @param {string} options.workDirectory - the directory to use for downloading the lambda zip file
**/
function runService (options, callback) {
  assert(options && typeof options === 'object', 'options.lambdaArn string is required');
  assert(options.lambdaArn && typeof options.lambdaArn === 'string', 'options.lambdaArn string is required');
  assert(options.activityArn && typeof options.activityArn === 'string', 'options.activityArn string is required');
  assert(options.taskDirectory && typeof options.taskDirectory === 'string', 'options.taskDirectory string is required');
  assert(options.workDirectory && typeof options.workDirectory === 'string', 'options.workDirectory string is required');

  const lambdaArn = options.lambdaArn;
  const activityArn = options.activityArn;
  const taskDir = options.taskDirectory;
  const workDir = options.workDirectory;

  process.env.CUMULUS_MESSAGE_ADAPTER_DIR=`${taskDir}/cumulus-message-adapter/`
  
  downloadLambdaHandler(lambdaArn, workDir, taskDir, function (err, handler) {
    if (err) return callback(err)

    const work = pollForWork(activityArn);
    work.on('error', callback);

    work.on('data', function (data) {

      if (data.taskToken && data.input) {
        const token = data.taskToken;
        const event = JSON.parse(data.input);
        const context = { via: 'ECS' };

        const heartbeat = startHeartbeat(token);

        handler(event, context, function (err, output) {
          clearInterval(heartbeat);

          if (err) {
            return sf.sendTaskFailure({
              taskToken: token,
              error: err.toString()
            }, function(err, data) {
              console.log('sendTaskFailure response', err.stack, data)
            })
          }

          sf.sendTaskSuccess({
            taskToken: token,
            output: JSON.stringify(output)
          }, function(err, data) {
            console.log('sendTaskSuccess response', err.stack, data)
          });
        });
      }
    });
  });
}

module.exports = runService;
