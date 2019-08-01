'use strict';

import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import test from 'ava';
import nock from 'nock';
import sinon from 'sinon';
import AWS from 'aws-sdk';
import archiver from 'archiver';
import { runTask, runServiceFromActivity } from '../index';

const { promisify } = require('util');
const { exec } = require('child_process');
const execPromise = promisify(exec);

test.beforeEach(async (t) => {
  t.context.tempDir = path.join(os.tmpdir(), 'cumulus-ecs-task', `${Date.now()}`, path.sep);
  fs.mkdirpSync(t.context.tempDir);
  t.context.lambdaZip = path.join(t.context.tempDir, 'remoteLambda.zip');
  t.context.layerZip = path.join(t.context.tempDir, 'fakeLayer.zip');
  t.context.lambdaCMAZip = path.join(t.context.tempDir, 'fakeCMALayer.zip');

  t.context.taskDirectory = path.join(t.context.tempDir, 'task');
  t.context.workDirectory = path.join(t.context.tempDir, '.tmp-work');
  t.context.layerDirectory = path.join(t.context.tempDir, 'layers');

  fs.mkdirpSync(t.context.taskDirectory);
  fs.mkdirpSync(t.context.workDirectory);
  fs.mkdirpSync(t.context.layerDirectory);

  // zip fake lambda
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(t.context.lambdaZip);
    const archive = archiver('zip');
    output.on('close', resolve);
    output.on('error', reject);
    archive.pipe(output);
    archive.file(path.join(__dirname, 'data/fakeLambda.js'), { name: 'fakeLambda.js' });
    archive.finalize();
  });

  // zip fake layer file
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(t.context.layerZip);
    const archive = archiver('zip');
    output.on('close', resolve);
    output.on('error', reject);
    archive.pipe(output);
    archive.file(path.join(__dirname, 'data/layerDataFile.txt'), { name: 'fakeLayer.txt' });
    archive.finalize();
  });

  // zip CMA injected  layer file
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(t.context.lambdaCMAZip);
    const archive = archiver('zip');
    output.on('close', resolve);
    output.on('error', reject);
    archive.pipe(output);
    archive.file(path.join(__dirname, 'data/fakeLambda.js'), { name: 'fakeLambda.js' });
    archive.file(path.join(__dirname, 'data/cumulus-message-adapter'),
      { name: 'cumulus-message-adapter' });
    archive.finalize();
  });

  const promiseOutput = await execPromise(`ls -l ${path.join(__dirname, 'data')}`);
  const zipOutput = await execPromise(`unzip -l ${t.context.lambdaCMAZip}`);

  console.log(`Zip output is ${JSON.stringify(zipOutput)}`);
  console.log(`Directory output is ${JSON.stringify(promiseOutput)}`);

  t.context.lambdaZipUrlPath = '/lambda';
  t.context.getLayerUrlPath = '/getLayer';


  nock('https://example.com')
    .get(t.context.lambdaZipUrlPath)
    .reply(200, () => fs.createReadStream(t.context.lambdaZip));

  nock('https://example.com')
    .get(t.context.getLayerUrlPath)
    .reply(200, () => fs.createReadStream(t.context.layerZip));

  t.context.expectedOutput = [
    'fakeLambda',
    'handler'
  ];

  t.context.stub = sinon.stub(AWS, 'Lambda')
    .returns({
      getLayerVersionByArn: () => ({
        promise: async () => ({
          LayerArn: 'notARealArn',
          Content: {
            Location: `https://example.com${t.context.getLayerUrlPath}`
          }
        })
      }),
      getFunction: () => ({
        promise: async () => ({
          Code: {
            Location: `https://example.com${t.context.lambdaZipUrlPath}`
          },
          Configuration: {
            Handler: t.context.expectedOutput.join('.'),
            Layers: ['notARealArn']
          }
        })
      })
    });
});

test.afterEach.always((t) => {
  nock.cleanAll();
  t.context.stub.restore();
  fs.removeSync(t.context.tempDir);
});

test.serial('test successful task run', async (t) => {
  const event = { hi: 'bye' };

  const output = await runTask({
    lambdaArn: 'arn:aws:lambda:region:account-id:function:fake-function',
    lambdaInput: event,
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory
  });
  t.deepEqual(event, output);
});

test.serial('layers are extracted into target directory', async (t) => {
  const event = { hi: 'bye' };
  await runTask({
    lambdaArn: 'arn:aws:lambda:region:account-id:function:fake-function',
    lambdaInput: event,
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory
  });
  t.true(fs.existsSync(`${t.context.layerDirectory}/fakeLayer.txt`));
});

test.serial('CMA environment variable is set if CMA is not present', async (t) => {
  const event = { hi: 'bye' };
  await runTask({
    lambdaArn: 'arn:aws:lambda:region:account-id:function:fake-function',
    lambdaInput: event,
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory
  });
  t.is(process.env.CUMULUS_MESSAGE_ADAPTER_DIR, t.context.layerDirectory);
});

test.serial('CMA environment variable is set if CMA is present', async (t) => {
  const event = { hi: 'bye' };
  nock.cleanAll();

  nock('https://example.com')
    .get(t.context.lambdaZipUrlPath)
      .reply(200, () => fs.createReadStream(t.context.lambdaCMAZip));

  nock('https://example.com')
    .get(t.context.getLayerUrlPath)
      .reply(200, () => fs.createReadStream(t.context.layerZip));

  await runTask({
    lambdaArn: 'arn:aws:lambda:region:account-id:function:fake-function',
    lambdaInput: event,
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory
  });
  t.is(process.env.CUMULUS_MESSAGE_ADAPTER_DIR,
    `${t.context.taskDirectory}/cumulus-message-adapter`);
});


test.serial('test failed task run', async (t) => {
  const event = { hi: 'bye', error: 'it failed' };
  const promise = runTask({
    lambdaArn: 'arn:aws:lambda:region:account-id:function:fake-function',
    lambdaInput: event,
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory
  });
  const error = await t.throws(promise);
  t.is(error, event.error);
});

test.serial('test activity success', async (t) => {
  const input = {
    msg: 'this was a success'
  };
  const token = 'some token';

  const sf = sinon.stub(AWS, 'StepFunctions')
    .returns({
      getActivityTask: () => ({
        promise: async () => ({
          taskToken: token,
          input: JSON.stringify(input)
        })
      }),
      sendTaskSuccess: (msg) => ({
        promise: () => {
          t.is(msg.output, JSON.stringify(input));
          t.is(msg.taskToken, token);
          return Promise.resolve();
        }
      })
    });

  await runServiceFromActivity({
    lambdaArn: 'test',
    activityArn: 'test',
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory,
    runForever: false
  });

  sf.restore();
});

test.serial('test activity failure', async (t) => {
  const input = {
    msg: 'this was a failure',
    error: {
      name: 'failure',
      message: 'it failed'
    }
  };
  const token = 'some token';

  const sf = sinon.stub(AWS, 'StepFunctions')
    .returns({
      getActivityTask: () => ({
        promise: async () => ({
          taskToken: token,
          input: JSON.stringify(input)
        })
      }),
      sendTaskFailure: (msg) => ({
        promise: () => {
          t.is(msg.error, input.error.name);
          t.is(msg.cause, input.error.message);
          return Promise.resolve();
        }
      })
    });

  await runServiceFromActivity({
    lambdaArn: 'test',
    activityArn: 'test',
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory,
    runForever: false
  });

  sf.restore();
});

test.serial('Retry zip download if connection-timeout received', async (t) => {
  nock.cleanAll();

  const timeoutFailure = nock('https://example.com')
    .get(t.context.lambdaZipUrlPath)
      .replyWithError({ code: 'ETIMEDOUT' });

  nock('https://example.com')
    .get(t.context.lambdaZipUrlPath)
      .reply(200, () => fs.createReadStream(t.context.lambdaZip));

  nock('https://example.com')
    .get(t.context.getLayerUrlPath)
      .reply(200, () => fs.createReadStream(t.context.layerZip));

  const event = { hi: 'bye' };

  const output = await runTask({
    lambdaArn: 'arn:aws:lambda:region:account-id:function:fake-function',
    lambdaInput: event,
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory,
  });

  t.true(timeoutFailure.isDone());
  t.deepEqual(event, output);
});
