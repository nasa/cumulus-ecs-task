'use strict';
/* eslint-disable no-console, max-len */
const https = require('https');
const path = require('path');
const execSync = require('child_process').execSync;
const assert = require('assert');

const AWS = require('aws-sdk');
const fs = require('fs');

const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
AWS.config.update({ region: region });

const sf = new AWS.StepFunctions({ apiVersion: '2016-11-23' });

/**
 * Constructs JSON to log and logs it
 *
 * @param {string} level - type of log (trace, debug, info, warn, error, fatal)
 * @param {string} message - message to log
 * @returns {undefined} - log is printed to stdout, nothing is returned
 */
function logMessage(level, message) {
  const time = new Date();
  const output = {
    level,
    timestamp: time.toISOString(),
    message
  };

  console.log(JSON.stringify(output));
}

/**
 *
 * @param {string} message - message to log
 * @param {Error} err - Error object
 * @returns {undefined} - log is printed to stdout, nothing is returned
 */
function logError(message, err) {
  // error stack with newlines and no leading space or tab will result in separate log entry
  let msg;
  if (err.stack) {
    msg = `${message} ${err.stack.replace(/\n/g, ' ')}`;
  }
  else {
    msg = err;
  }
  logMessage('error', msg);
}

/**
* Download the zip file of a lambda function from AWS
*
* @param {string} arn - the arn of the lambda function
* @param {strind} workDir - the dir to download the lambda function to
* @returns {Promise<Object>} returns an object that includes `filepath`,
* `moduleFileName`, `moduleFunctionName` arguments.
* The `filepath` is the path to the zip file of the lambda function.
* The `moduleFileName` is the filename of the node module.
* The `moduleFunctionName` is the name of the exported function to call in the module.
**/
async function getLambdaZip(arn, workDir) {
  const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

  const data = await lambda.getFunction({ FunctionName: arn }).promise();

  const codeUrl = data.Code.Location;
  const handlerId = data.Configuration.Handler;
  const moduleFn = handlerId.split('.');
  const moduleFileName = moduleFn[0];
  const moduleFunctionName = moduleFn[1];

  const filepath = path.join(workDir, 'fn.zip');
  const file = fs.createWriteStream(filepath);

  return new Promise((resolve, reject) => {
    file.on('error', reject);
    file.on('finish', () => file.close());
    file.on('close', () => resolve({ filepath, moduleFileName, moduleFunctionName }));

    return https.get(codeUrl, (res) => res.pipe(file));
  });
}

/**
* Downloads and extracts the code of a lambda function from its zip file
*
* @param {string} lambdaArn - the arn of the lambda function
* @param {string} workDir - the temporary dir used to download the lambda zip file
* @param {string} taskDir - the dir where the lambda function will be located
* @returns {Promise<Function>} the `handler` which is the javascript function
*                              that will run in the ECS service
**/
async function downloadLambdaHandler(lambdaArn, workDir, taskDir) {
  const resp = await getLambdaZip(lambdaArn, workDir);

  execSync(`unzip -o ${resp.filepath} -d ${taskDir}`);
  const task = require(`${taskDir}/${resp.moduleFileName}`); //eslint-disable-line global-require
  return task[resp.moduleFunctionName];
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
        logError('error sending heartbeat', err);
      }
      logMessage('info', `sending heartbeat, confirming ${taskToken} is still in progress`);
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
      logError('sendTaskFailure err', err);
    }
    logMessage('info', `task failed for ${taskToken}`);
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
      logError('sendTaskSuccess failed', err);
    }
    logMessage('info', `task completed successfully for ${taskToken}`);
  });
}

/**
* receives an activity message from the StepFunction Activity Queue
*
* @param {string} activityArn - the activity arn
* @returns {Promise} the lambda task event object and the
*                    activity task's token. If the activity task returns
*                    empty, the function returns undefined response
**/
async function getActivityTask(activityArn) {
  const data = await sf.getActivityTask({ activityArn }).promise();
  if (data && data.taskToken && data.taskToken.length && data.input) {
    const token = data.taskToken;
    const event = JSON.parse(data.input);
    return {
      event,
      token
    };
  }
  logMessage('info', 'No tasks in the activity queue');
  return undefined;
}


/**
* Handle the lambda task response
*
* @param {Object} event - the event to pass to the lambda function
* @param {Function} handler - the lambda function to execute
* @returns {Promise} the lambda functions response
**/
function handleResponse(event, handler) {
  const context = { via: 'ECS' };

  return new Promise((resolve, reject) => {
    handler(event, context, (err, output) => {
      if (err) {
        return reject(err);
      }
      return resolve(output);
    });
  });
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
async function handlePollResponse(event, taskToken, handler, heartbeatInterval) {
  let heartbeat;

  if (heartbeatInterval) {
    heartbeat = startHeartbeat(taskToken);
  }

  try {
    const output = await handleResponse(event, handler);
    if (heartbeatInterval) {
      clearInterval(heartbeat);
    }
    sendTaskSuccess(taskToken, JSON.stringify(output));
  }
  catch (err) {
    sendTaskFailure(taskToken, err);
  }
}

/**
* Start the Lambda handler as a one time task. When the task completes
* the process exits
*
* @param {Object} options - options object
* @param {string} options.lambdaArn - the arn of the lambda handler
* @param {string} options.lambdaInput - the input to the lambda handler
* @param {string} options.taskDirectory - the directory to put the unzipped lambda zip
* @param {string} options.workDirectory - the directory to use for downloading the lambda zip file
* @returns {Promise} the output of the lambda function response
**/
async function runTask(options) {
  assert(options && typeof options === 'object', 'options.lambdaArn string is required');
  assert(options && typeof options.lambdaInput === 'object', 'options.lambdaInput object is required');
  assert(options.taskDirectory && typeof options.taskDirectory === 'string', 'options.taskDirectory string is required');
  assert(options.workDirectory && typeof options.workDirectory === 'string', 'options.workDirectory string is required');
  const lambdaArn = options.lambdaArn;
  const event = options.lambdaInput;
  const taskDir = options.taskDirectory;
  const workDir = options.workDirectory;

  // the cumulus-message-adapter dir is in an unexpected place,
  // so tell the adapter where to find it
  process.env.CUMULUS_MESSAGE_ADAPTER_DIR = `${taskDir}/cumulus-message-adapter/`;

  logMessage('info', 'Downloading the Lambda function');
  try {
    const handler = await downloadLambdaHandler(lambdaArn, workDir, taskDir);
    const output = await handleResponse(event, handler);
    logMessage('info', 'task executed successfully');
    return output;
  }
  catch (e) {
    logError('task failed with an error', e);
    throw e;
  }
}

/**
* Start the Lambda handler as a service by polling a sqs queue
* The function will not quit unless the process is terminated
*
* @param {Object} options - options object
* @param {string} options.lambdaArn - the arn of the lambda handler
* @param {string} options.sqsUrl   - the url to the sqs queue
* @param {integer} options.heartbeat - number of milliseconds between heartbeat messages.
* defaults to null, which deactivates heartbeats
* @param {string} options.taskDirectory - the directory to put the unzipped lambda zip
* @param {string} options.workDirectory - the directory to use for downloading the lambda zip file
* @param {boolean} [options.runForever=true] - whether to poll the activity forever (defaults to true)
* @returns {Promise<undefined>} undefined
**/
async function runServiceFromSQS(options) {
  assert(options && typeof options === 'object', 'options.lambdaArn string is required');
  assert(options.lambdaArn && typeof options.lambdaArn === 'string', 'options.lambdaArn string is required');
  assert(options.sqsUrl && typeof options.sqsUrl === 'string', 'options.sqsUrl string is required');
  assert(options.taskDirectory && typeof options.taskDirectory === 'string', 'options.taskDirectory string is required');
  assert(options.workDirectory && typeof options.workDirectory === 'string', 'options.workDirectory string is required');

  const sqs = new AWS.SQS({ apiVersion: '2016-11-23' });

  const lambdaArn = options.lambdaArn;
  const sqsUrl = options.sqsUrl;
  const taskDir = options.taskDirectory;
  const workDir = options.workDirectory;
  const runForever = options.runForever || true;

  // the cumulus-message-adapter dir is in an unexpected place,
  // so tell the adapter where to find it
  process.env.CUMULUS_MESSAGE_ADAPTER_DIR = `${taskDir}/cumulus-message-adapter/`;

  logMessage('info', 'Downloading the Lambda function');
  const handler = await downloadLambdaHandler(lambdaArn, workDir, taskDir);
  let counter = 1;
  while (runForever) {
    try {
      logMessage('info', `[${counter}] Getting tasks from ${sqsUrl}`);
      const resp = await sqs.receiveMessage({
        QueueUrl: sqsUrl,
        WaitTimeSeconds: 20
      }).promise();
      const messages = resp.Messages;
      if (messages) {
        const promises = messages.map(async (message) => {
          if (message && message.Body) {
            const receipt = message.ReceiptHandle;
            logMessage('info', 'received message from queue, executing the task');
            const event = JSON.parse(message.Body);
            await handleResponse(event, handler);

            // remove the message from queue
            logMessage('info', `message with handler ${receipt} deleted from the queue`);
            await sqs.deleteMessage({ QueueUrl: sqsUrl, ReceiptHandle: receipt }).promise();
          }
          return undefined;
        });
        await promises;
      }
      else {
        logMessage('info', 'There are no new messages in the queue. Polling again!');
      }
    }
    catch (e) {
      logError('Task failed. trying again', e);
    }
    counter += 1;
  }
}

/**
* Start the Lambda handler as a service by polling a SF activity queue
* The function will not quit unless the process is terminated
*
* @param {Object} options - options object
* @param {string} options.lambdaArn - the arn of the lambda handler
* @param {string} options.activityArn - the arn of the activity
* @param {integer} options.heartbeat - number of milliseconds between heartbeat messages.
* defaults to null, which deactivates heartbeats
* @param {string} options.taskDirectory - the directory to put the unzipped lambda zip
* @param {string} options.workDirectory - the directory to use for downloading the lambda zip file
* @param {boolean} [options.runForever=true] - whether to poll the activity forever (defaults to true)
* @returns {Promise<undefined>} undefined
**/
async function runServiceFromActivity(options) {
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
  const runForever = options.runForever || true;

  // the cumulus-message-adapter dir is in an unexpected place,
  // so tell the adapter where to find it
  process.env.CUMULUS_MESSAGE_ADAPTER_DIR = `${taskDir}/cumulus-message-adapter/`;

  logMessage('info', 'Downloading the Lambda function');
  const handler = await downloadLambdaHandler(lambdaArn, workDir, taskDir);
  let counter = 1;
  while (runForever) {
    logMessage('info', `[${counter}] Getting tasks from ${activityArn}`);
    try {
      const activity = await getActivityTask(activityArn);
      if (activity) {
        await handlePollResponse(
          activity.event,
          activity.token,
          handler,
          heartbeatInterval
        );
      }
    }
    catch (e) {
      logError('Task failed. trying again', e);
    }
    counter += 1;
  }
}

module.exports = {
  runServiceFromActivity,
  runServiceFromSQS,
  runTask,
  logMessage
};
