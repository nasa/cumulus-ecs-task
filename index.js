/* eslint max-len: "off" */

'use strict';

const https = require('https');
const isBoolean = require('lodash/isBoolean');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const execPromise = promisify(exec);

const assert = require('assert');
const pRetry = require('p-retry');

const {
  setIntervalAsync,
  clearIntervalAsync
} = require('set-interval-async');

const {
  Lambda,
  GetFunctionCommand,
  GetLayerVersionByArnCommand
} = require('@aws-sdk/client-lambda');
const {
  GetActivityTaskCommand,
  SendTaskFailureCommand,
  SendTaskHeartbeatCommand,
  SendTaskSuccessCommand,
  SFN
} = require('@aws-sdk/client-sfn');
const {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQS
} = require('@aws-sdk/client-sqs');
const fs = require('fs');

const Logger = require('./Logger');
const log = new Logger();

/**
 * @typedef {import('@aws-sdk/client-sfn').SendTaskFailureCommandOutput} SendTaskFailureCommandOutput
 * @typedef {import('@aws-sdk/client-sfn').SendTaskSuccessCommandOutput} SendTaskSuccessCommandOutput
 */

const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
const layersDefaultDirectory = '/opt/';

// eslint-disable-next-line require-jsdoc
const isLambdaFunctionArn = (id) => id.startsWith('arn:aws:lambda');

// eslint-disable-next-line require-jsdoc
function getFunctionName(lambdaId) {
  if (isLambdaFunctionArn(lambdaId)) {
    const FUNCTION_NAME_FIELD = 6;
    return lambdaId.split(':')[FUNCTION_NAME_FIELD];
  }

  return lambdaId;
}

/**
 * Download a URL to file
 *
 * @param {string} url - the URL to fetch
 * @param {string} destinationFilename - the filename to write the file to
 * @returns {Promise<undefined>} resolves when file has been downloaded
 */
function tryToDownloadFile(url, destinationFilename) {
  const file = fs.createWriteStream(destinationFilename);
  return new Promise((resolve, reject) => {
    file.on('error', reject);
    file.on('finish', () => file.close());
    file.on('close', resolve);

    return https
      .get(url, (res) => res.pipe(file))
      .on('error', reject);
  });
}

// eslint-disable-next-line require-jsdoc
const getLogSenderFromLambdaId = (lambdaId) => `cumulus-ecs-task/${getFunctionName(lambdaId)}`;

/**
 * Download a URL and save it to a file.  If an ETIMEDOUT error is received,
 * retry the download with an incremental backoff.
 *
 * @param {string} url - the URL to fetch
 * @param {string} destinationFilename - the filename to write the file to
 * @returns {Promise<undefined>} resolves when file has been downloaded
 */
function downloadFile(url, destinationFilename) {
  return pRetry(() => tryToDownloadFile(url, destinationFilename).catch((err) => {
    if (err.code === 'ETIMEDOUT') {
      throw err;
    }
    throw new pRetry.AbortError(err);
  }));
}

/**
 * Downloads an array of layers from AWS
 *
 * @param {Array<Object>} layers - list of layer config objects to download
 * @param {Array<string>} layersDir - path to download the files to, generally '/opt'
 * @returns {Promise<Array>}  - returns an array of promises that resolve to a
 *                              filepath strings to downloaded layer .zips
 */
async function downloadLayers(layers, layersDir) {
  const layerDownloadPromises = layers.map((layer) => {
    log.info(`Adding layer ${JSON.stringify(layer)} to container`);
    const filePath = `${layersDir}/${getFunctionName(layer.LayerArn)}.zip`;
    return downloadFile(layer.Content.Location, filePath).then(() => filePath);
  });
  return Promise.all(layerDownloadPromises);
}

/**
* Download the zip file of a lambda function from AWS
* and it's associated layer .zip files, if any.
*
* @param {string} arn - the arn of the lambda function
* @param {string} workDir - the dir to download the lambda function to
* @param {string} layersDir - the dir layers will be downloaded to
* @returns {Promise<Object>} returns an object that includes `filepath`,
* `moduleFileName`, `moduleFunctionName` arguments.
* The `filepath` is the path to the zip file of the lambda function.
* The `moduleFileName` is the filename of the node module.
* The `moduleFunctionName` is the name of the exported function to call in the module.
* The `layerPaths` is an array of filepaths to downloaded layer zip files
**/
async function getLambdaSource(arn, workDir, layersDir) {
  const lambda = new Lambda({ apiVersion: '2015-03-31', region });

  const data = await lambda.send(new GetFunctionCommand({ FunctionName: arn }));

  const codeUrl = data.Code.Location;
  const handlerId = data.Configuration.Handler;
  const moduleFn = handlerId.split('.');
  const moduleFileName = moduleFn[0];
  const moduleFunctionName = moduleFn[1];

  let layerPaths = [];
  if (data.Configuration.Layers) {
    const layers = data.Configuration.Layers;
    const layerConfigs = await Promise.all(
      layers.map(async(layer) => {
        const getLayerVersionByArnCommand = new GetLayerVersionByArnCommand({ Arn: layer.Arn });
        return lambda.send(getLayerVersionByArnCommand);
      })
    );

    layerPaths = await downloadLayers(layerConfigs, layersDir);
  }

  const filepath = path.join(workDir, 'fn.zip');
  await downloadFile(codeUrl, filepath);
  return {
    filepath,
    moduleFileName,
    moduleFunctionName,
    layerPaths
  };
}

/**
 * Given a task dir, detects if the CMA is present in that
 * directory.  Sets CUMULUS_MESSAGE_ADAPTER_DIR env variable to that
 * directory, else sets it to the default layersDir used
 * by lambda layers.
 *
 * @param  {string} taskDir - The path to the ECS task source
 * @param {string} layerDir - The directory layers are extracted to
 * @returns {undefined} - no return value
 */
function setCumulusMessageAdapterPath(taskDir, layerDir) {
  const CmaPath = `${taskDir}/cumulus-message-adapter`;
  const adapterPath = fs.existsSync(CmaPath) ? CmaPath : layerDir;
  log.info(`Setting CMA path to ${adapterPath}`);
  process.env.CUMULUS_MESSAGE_ADAPTER_DIR = adapterPath;
}

/**
* Downloads and extracts the code of a lambda function and it's associated layers
* into expected locations on the filesystem
*
* @param {string} lambdaArn - the arn of the lambda function
* @param {string} workDir - the temporary dir used to download the lambda zip file
* @param {string} taskDir - the dir where the lambda function will be located
* @param {string} layerDir - the dir where layers are to be extracted/used.  Generally /opt.
* @returns {Promise<Function>} the `handler` which is the javascript function
*                              that will run in the ECS service
**/
async function installLambdaFunction(lambdaArn, workDir, taskDir, layerDir) {
  const resp = await getLambdaSource(lambdaArn, workDir, layerDir);
  const unzipPromises = resp.layerPaths.map((layerFilePath) => execPromise(`unzip -q -o ${layerFilePath} -d ${layerDir}`));
  unzipPromises.push(execPromise(`unzip -q -o ${resp.filepath} -d ${taskDir}`));
  await Promise.all(unzipPromises);

  setCumulusMessageAdapterPath(taskDir, layerDir);

  const task = require(`${taskDir}/${resp.moduleFileName}`); //eslint-disable-line import/no-dynamic-require,global-require
  return task[resp.moduleFunctionName];
}

/**
* Starts heartbeat to indicate worker is working on the task
*
* @param {string} taskToken - the task token
* @param {integer} heartbeatInterval - number of milliseconds between heartbeat messages
* @returns {SetIntervalAsyncTimer} - interval id used by `clearIntervalAsync`
**/
function startHeartbeat(taskToken, heartbeatInterval) {
  const sf = new SFN({ apiVersion: '2016-11-23', region });
  return setIntervalAsync(async() => {
    try {
      const sendTaskHeartbeatCommand = new SendTaskHeartbeatCommand({
        taskToken
      });
      await sf.send(sendTaskHeartbeatCommand);
      log.info(`sending heartbeat, confirming ${taskToken} is still in progress`);
    }
    catch (err) {
      log.error('error sending heartbeat', err);
    }
  }, heartbeatInterval);
}

/**
* Tells workflow that the task has failed
*
* @param {string} taskToken - the task token
* @param {Object} taskError - the error object returned by the handler
* @returns {SendTaskFailureCommandOutput} - step function send task failure output
**/
async function sendTaskFailure(taskToken, taskError) {
  const sf = new SFN({ apiVersion: '2016-11-23', region });
  const sendTaskFailureCommand = new SendTaskFailureCommand({
    taskToken: taskToken,
    error: taskError.name,
    cause: taskError.message
  });

  return sf.send(sendTaskFailureCommand);
}

/**
* Tells workflow that the task has succeeded and provides message for next task
*
* @param {string} taskToken - the task token
* @param {Object} output - output message for next task
* @returns {SendTaskSuccessCommandOutput} - step function send task success output
**/
async function sendTaskSuccess(taskToken, output) {
  const sf = new SFN({ apiVersion: '2016-11-23', region });
  const sendTaskSuccessCommand = new SendTaskSuccessCommand({
    taskToken: taskToken,
    output: output
  });

  return sf.send(sendTaskSuccessCommand);
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
  const sf = new SFN({ apiVersion: '2016-11-23', region });
  const data = await sf.send(new GetActivityTaskCommand({ activityArn }));

  if (data && data.taskToken && data.taskToken.length && data.input) {
    const token = data.taskToken;
    const event = JSON.parse(data.input);
    return {
      event,
      token
    };
  }
  log.info('No tasks in the activity queue');
  return undefined;
}

/**
* Handle the lambda task response
*
* @param {Object} event - the event to pass to the lambda function
* @param {Function} handler - the lambda function to execute
* @returns {Promise} the lambda functions response
**/
async function handleResponse(event, handler) {
  return handler(event, { via: 'ECS' });
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
    heartbeat = startHeartbeat(taskToken, heartbeatInterval);
  }

  try {
    const output = await handleResponse(event, handler);
    if (heartbeatInterval) {
      await clearIntervalAsync(heartbeat);
    }
    await sendTaskSuccess(taskToken, JSON.stringify(output));
  }
  catch (err) {
    await sendTaskFailure(taskToken, err);
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
  assert(!options.layersDirectory || typeof options.layersDirectory === 'string', 'options.layersDir should be a string');

  const layersDir = options.layersDirectory ? options.layersDirectory : layersDefaultDirectory;
  const {
    lambdaArn, lambdaInput, taskDirectory, workDirectory
  } = options;

  log.sender = getLogSenderFromLambdaId(lambdaArn);

  log.info('Downloading the Lambda function');
  try {
    const handler = await installLambdaFunction(lambdaArn, workDirectory, taskDirectory, layersDir);
    const output = await handleResponse(lambdaInput, handler);
    log.info('task executed successfully');
    return output;
  }
  catch (e) {
    log.error('task failed with an error', e);
    throw e;
  }
}

/**
* Start the Lambda handler as a service by polling a sqs queue
* The function will not quit unless the process is terminated
*
* @param {Object} options - options object
* @param {string} options.lambdaArn - the arn of the lambda handler
* @param {string} options.sqsUrl - the url to the sqs queue
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
  assert(!options.layersDirectory || typeof options.layersDirectory === 'string', 'options.layersDir should be a string');

  const sqs = new SQS({ region });

  const {
    lambdaArn, sqsUrl, taskDirecotry, workDirectory
  } = options;
  const layersDir = options.layersDirectory ? options.layersDirectory : layersDefaultDirectory;

  const runForever = isBoolean(options.runForever) ? options.runForever : true;

  log.sender = getLogSenderFromLambdaId(lambdaArn);

  log.info('Downloading the Lambda function');
  const handler = await installLambdaFunction(lambdaArn, workDirectory, taskDirecotry, layersDir);

  let sigTermReceived = false;
  process.on('SIGTERM', () => {
    log.info('Received SIGTERM, will stop polling for new work');
    sigTermReceived = true;
  });

  /* eslint-disable no-await-in-loop*/
  let counter = 1;
  do {
    try {
      log.info(`[${counter}] Getting tasks from ${sqsUrl}`);
      const resp = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: sqsUrl,
        WaitTimeSeconds: 20
      }));
      const messages = resp.Messages;
      if (messages) {
        const promises = messages.map(async(message) => {
          if (message && message.Body) {
            const receipt = message.ReceiptHandle;
            log.info('received message from queue, executing the task');
            const event = JSON.parse(message.Body);
            await handleResponse(event, handler);

            // remove the message from queue
            log.info(`message with handler ${receipt} deleted from the queue`);
            await sqs.deleteMessage(new DeleteMessageCommand({
              QueueUrl: sqsUrl,
              ReceiptHandle: receipt
            }));
          }
          return undefined;
        });
        await promises;
      }
      else {
        log.info('There are no new messages in the queue. Polling again!');
      }
    }
    catch (e) {
      log.error('Task failed. trying again', e);
    }
    counter += 1;
  } while (runForever && !sigTermReceived);

  log.info('Exiting');
}
/* eslint-enable no-await-in-loop*/

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
* @param {string} options.layersDir - the directory to use for extracting lambda layers.  Defaults to /opt
* @param {boolean} [options.runForever=true] - whether to poll the activity forever (defaults to true)
* @returns {Promise<undefined>} undefined
**/
async function runServiceFromActivity(options) {
  assert(options && typeof options === 'object', 'options.lambdaArn string is required');
  assert(options.lambdaArn && typeof options.lambdaArn === 'string', 'options.lambdaArn string is required');
  assert(options.activityArn && typeof options.activityArn === 'string', 'options.activityArn string is required');
  assert(options.taskDirectory && typeof options.taskDirectory === 'string', 'options.taskDirectory string is required');
  assert(options.workDirectory && typeof options.workDirectory === 'string', 'options.workDirectory string is required');
  assert(!options.layersDirectory || typeof options.layersDirectory === 'string', 'options.layersDir should be a string');

  if (options.heartbeat) {
    assert(Number.isInteger(options.heartbeat), 'options.heartbeat must be an integer');
  }

  const {
    lambdaArn, activityArn, taskDirectory, workDirectory, heartbeat
  } = options;
  const layersDir = options.layersDirectory ? options.layersDirectory : layersDefaultDirectory;

  const runForever = isBoolean(options.runForever) ? options.runForever : true;

  log.sender = getLogSenderFromLambdaId(lambdaArn);

  log.info('Downloading the Lambda function');
  const handler = await installLambdaFunction(lambdaArn, workDirectory, taskDirectory, layersDir);

  let sigTermReceived = false;
  process.on('SIGTERM', () => {
    log.info('Received SIGTERM, will stop polling for new work');
    sigTermReceived = true;
  });

  /* eslint-disable no-await-in-loop*/

  let counter = 1;
  do {
    log.info(`[${counter}] Getting tasks from ${activityArn}`);
    let activity;
    try {
      activity = await getActivityTask(activityArn);
      if (activity) {
        await handlePollResponse(
          activity.event,
          activity.token,
          handler,
          heartbeat
        );
      }
    }
    catch (e) {
      log.error('Task failed. trying again', e);
      if (activity) {
        await sendTaskFailure(activity.token, e);
      }
    }
    counter += 1;
  } while (runForever && !sigTermReceived);

  log.info('Exiting');
}
/* eslint-enable no-await-in-loop*/

module.exports = {
  runServiceFromActivity,
  runServiceFromSQS,
  runTask
};
