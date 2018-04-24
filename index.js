'use strict';
/* eslint-disable no-console, max-len */
const https = require('https');
const path = require('path');
const execSync = require('child_process').execSync;
const assert = require('assert');
const EventEmitter = require('events').EventEmitter;

const AWS = require('aws-sdk');
const fs = require('fs');

const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
AWS.config.update({ region: region });

const sf = new AWS.StepFunctions({ apiVersion: '2016-11-23' });

/**
* Download the zip file of a lambda function from AWS
*
* @param {string} arn - the arn of the lambda function
* @param {strind} workDir - the dir to download the lambda function to
* @param {function} callback - callback function with `err`, `filepath`, `moduleFileName`,
* and `moduleFunctionName` arguments.
* The `filepath` is the path to the zip file of the lambda function.
* The `moduleFileName` is the filename of the node module.
* The `moduleFunctionName` is the name of the exported function to call in the module.
* @returns {undefined} - callback is used instead of return value
**/
function getLambdaZip(arn, workDir, callback) {
  const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

  lambda.getFunction({ FunctionName: arn }, (err, data) => {
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

    return https.get(codeUrl, (res) => res.pipe(file));
  });
}

/**
* Downloads and extracts the code of a lambda function from its zip file
*
* @param {string} lambdaArn - the arn of the lambda function
* @param {string} workDir - the temporary dir used to download the lambda zip file
* @param {string} taskDir - the dir where the lambda function will be located
* @param {function} callback - callback function with `err`, `handler` arguments
* the `handler` is the javascript function that will run in the ECS service
* @returns {undefined} - callback is used instead of return value
**/
function downloadLambdaHandler(lambdaArn, workDir, taskDir, callback) {
  return getLambdaZip(lambdaArn, workDir, (err, filepath, moduleFileName, moduleFunctionName) => {
    if (err) return callback(err);

    execSync(`unzip -o ${filepath} -d ${taskDir}`);
    const task = require(`${taskDir}/${moduleFileName}`); //eslint-disable-line global-require
    return callback(null, task[moduleFunctionName]);
  });
}

/**
* Starts heartbeat to indicate worker is working on the task
*
* @param {string} taskToken - the task token
* @returns {intervalId} - interval id used by `clearInterval`
**/
function startHeartbeat(taskToken) {
  return setInterval(() => {
    sf.sendTaskHeartbeat({ taskToken }, (err) => {
      if (err) {
        console.log('error sending heartbeat', err);
      }
    }, 60000);
  });
}

/**
* Tells workflow that the task has failed
*
* @param {string} taskToken - the task token
* @param {Object} taskError - the error object returned by the handler
* @returns {undefined} - no return value
**/
function sendTaskFailure(taskToken, taskError) {
  sf.sendTaskFailure({
    taskToken: taskToken,
    error: taskError.name,
    cause: taskError.message
  }, (err) => {
    if (err) {
      console.log('sendTaskFailure err', err);
    }
  });
}

/**
* Tells workflow that the task has succeeded and provides message for next task
*
* @param {string} taskToken - the task token
* @param {Object} output - output message for next task
* @returns {undefined} - no return value
**/
function sendTaskSuccess(taskToken, output) {
  sf.sendTaskSuccess({
    taskToken: taskToken,
    output: output
  }, (err) => {
    if (err) {
      console.log('sendTasksuccess error', err);
    }
  });
}

/**
* Simple class for polling the state machine for work
**/
class TaskPoll extends EventEmitter {
  /**
  * initialize Poll class
  *
  * @param {string} activityArn - the lambda activity arn
  * @returns {undefined} - no return value
  **/
  constructor(activityArn) {
    super();
    this.activityArn = activityArn;
  }

  /**
  * start polling
  *
  * @returns {undefined} - no return value
  **/
  start() {
    // kick off sf.getActivityTask
    this.getTask();
    // repeat every 70 seconds (the timeout of sf.getActivityTask)
    this.intervalId = setInterval(() => this.getTask(), 70000);
  }

  /**
  * repeatedly checks for work using sf.getActivityTask
  *
  * @returns {undefined} - no return value
  **/
  getTask() {
    sf.getActivityTask({ activityArn: this.activityArn }, (err, data) => {
      if (err) {
        this.emit('error', err);
      }
      else if (data && data.taskToken && data.taskToken.length && data.input) {
        const token = data.taskToken;
        const event = JSON.parse(data.input);
        clearInterval(this.intervalId);
        this.emit('data', event, token);
      }
    });
  }
}

/**
* Handle the data event from poll.getTask()
*
* @param {Object} event - the event to pass to the lambda function
* @param {string} taskToken - the task token
* @param {function} handler - the lambda function to execute
* @param {integer} heartbeatInterval - number of milliseconds between heartbeat messages.
* defaults to null, which deactivates heartbeats
* @returns {undefined} - no return value
**/
function handlePollResponse(event, taskToken, handler, heartbeatInterval) {
  const context = { via: 'ECS' };
  let heartbeat;

  if (heartbeatInterval) {
    heartbeat = startHeartbeat(taskToken);
  }

  handler(event, context, (err, output) => {
    if (heartbeatInterval) {
      clearInterval(heartbeat);
    }

    if (err) {
      sendTaskFailure(taskToken, err);
    }
    else {
      sendTaskSuccess(taskToken, JSON.stringify(output));
    }
  });
}

/**
* Start the Lambda handler as a service
*
* @param {Object} options - options object
* @param {string} options.lambdaArn - the arn of the lambda handler
* @param {string} options.activityArn - the arn of the activity
* @param {integer} options.heartbeat - number of milliseconds between heartbeat messages.
* defaults to null, which deactivates heartbeats
* @param {string} options.taskDirectory - the directory to put the unzipped lambda zip
* @param {string} options.workDirectory - the directory to use for downloading the lambda zip file
* @returns {undefined} - callback is used instead of return value
**/
function runService(options) {
  assert(options && typeof options === 'object', 'options.lambdaArn string is required');
  assert(options.lambdaArn && typeof options.lambdaArn === 'string', 'options.lambdaArn string is required');
  assert(options.activityArn && typeof options.activityArn === 'string', 'options.activityArn string is required');
  assert(options.taskDirectory && typeof options.taskDirectory === 'string', 'options.taskDirectory string is required');
  assert(options.workDirectory && typeof options.workDirectory === 'string', 'options.workDirectory string is required');
  if (options.heartbeat) {
    assert(Number.isInteger(options.heartbeat), 'options.heartbeat must be an integer');
  }

  const lambdaArn = options.lambdaArn;
  const activityArn = options.activityArn;
  const taskDir = options.taskDirectory;
  const workDir = options.workDirectory;
  const heartbeatInterval = options.heartbeat;

  // the cumulus-message-adapter dir is in an unexpected place,
  // so tell the adapter where to find it
  process.env.CUMULUS_MESSAGE_ADAPTER_DIR = `${taskDir}/cumulus-message-adapter/`;

  downloadLambdaHandler(lambdaArn, workDir, taskDir, (downloadError, handler) => {
    if (downloadError) {
      // if lambda isn't downloaded, throw the error, as nothing else will work
      throw downloadError;
    }

    const poll = new TaskPoll(activityArn, heartbeatInterval);

    poll.on('error', (err) => {
      console.log('error polling for work with sf.getActivityTask', err);
    });

    poll.on('data', (event, taskToken) => {
      handlePollResponse(event, taskToken, handler, heartbeatInterval);
    });

    poll.start();
  });
}

module.exports = runService;
