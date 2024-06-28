'use strict';

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const nock = require('nock');
const archiver = require('archiver');
const { runTask, runServiceFromActivity } = require('../index');
const { mockClient } = require('aws-sdk-client-mock');
const {
  Lambda,
  GetLayerVersionByArnCommand,
  GetFunctionCommand
} = require('@aws-sdk/client-lambda');
const { 
  GetActivityTaskCommand, 
  SendTaskSuccessCommand,
  SFN, 
  SendTaskFailureCommand
} = require('@aws-sdk/client-sfn');

const lambdaMock = mockClient(Lambda);

test.beforeEach(async(t) => {
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
    archive.file(path.join(__dirname, 'data/cumulus-message-adapter.txt'),
      { name: 'cumulus-message-adapter' });
    archive.finalize();
  });

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

  lambdaMock
    .onAnyCommand()
    .rejects()
    .on(GetLayerVersionByArnCommand)
    .resolves({
      LayerArn: 'notARealArn',
      Content: {
        Location: `https://example.com${t.context.getLayerUrlPath}`
      }
    })
    .on(GetFunctionCommand)
    .resolves({
      Code: {
        Location: `https://example.com${t.context.lambdaZipUrlPath}`
      },
      Configuration: {
        Handler: t.context.expectedOutput.join('.'),
        Layers: ['notARealArn']
      }
    });
  //   .returns({
  //     getLayerVersionByArn: () => ({
  //       promise: async() => ({
  //         LayerArn: 'notARealArn',
  //         Content: {
  //           Location: `https://example.com${t.context.getLayerUrlPath}`
  //         }
  //       })
  //     }),
  //     getFunction: () => ({
  //       promise: async() => ({
  //         Code: {
  //           Location: `https://example.com${t.context.lambdaZipUrlPath}`
  //         },
  //         Configuration: {
  //           Handler: t.context.expectedOutput.join('.'),
  //           Layers: ['notARealArn']
  //         }
  //       })
  //     })
  //   });
});

test.afterEach.always((t) => {
  nock.cleanAll();
  lambdaMock.reset();
  fs.removeSync(t.context.tempDir);
});

test.serial('test successful task run', async(t) => {
  const event = { hi: 'bye' };

  const lambdaMock = mockClient(Lambda);
  lambdaMock
    .onAnyCommand()
    .rejects()
    .on(GetLayerVersionByArnCommand)
    .resolves({
      LayerArn: 'notARealArn',
      Content: {
        Location: `https://example.com${t.context.getLayerUrlPath}`
      }
    })
    .on(GetFunctionCommand)
    .resolves({
      Code: {
        Location: `https://example.com${t.context.lambdaZipUrlPath}`
      },
      Configuration: {
        Handler: t.context.expectedOutput.join('.'),
        Layers: ['notARealArn']
      }
    });

  const output = await runTask({
    lambdaArn: 'arn:aws:lambda:region:account-id:function:fake-function',
    lambdaInput: event,
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory
  });
  t.deepEqual(event, output);
});

test.serial('layers are extracted into target directory', async(t) => {
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

test.serial('CMA environment variable is set if CMA is not present', async(t) => {
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

test.serial('CMA environment variable is set if CMA is present', async(t) => {
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

test.serial('test failed task run', async(t) => {
  const event = { hi: 'bye', error: 'it failed' };
  const promise = runTask({
    lambdaArn: 'arn:aws:lambda:region:account-id:function:fake-function',
    lambdaInput: event,
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory
  });
  await t.throwsAsync(promise, { message: event.error });
});

test.serial('test activity success', async(t) => {
  const input = {
    msg: 'this was a success'
  };
  const token = 'some token';

  const sfnMock = mockClient(SFN);
  sfnMock
    .onAnyCommand()
    .rejects()
    .on(GetActivityTaskCommand)
    .resolves({
      taskToken: token,
      input: JSON.stringify(input)
    })
    .on(SendTaskSuccessCommand)
    .callsFake(msg => {
      t.is(msg.output, JSON.stringify(input));
      t.is(msg.taskToken, token);
      
      return Promise.resolve();
    });

  await runServiceFromActivity({
    lambdaArn: 'test',
    activityArn: 'test',
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory,
    runForever: false
  });

  sfnMock.restore();
});

test.serial('test activity failure', async(t) => {
  const input = {
    msg: 'this was a failure',
    error: 'it failed'
  };
  const token = 'some token';

  const sfnMock = mockClient(SFN);
  sfnMock
    .onAnyCommand()
    .rejects()
    .on(GetActivityTaskCommand)
    .resolves({
      taskToken: token,
      input: JSON.stringify(input)
    })
    .on(SendTaskFailureCommand)
    .callsFake(msg => {
      t.is(msg.error, 'Error');
      t.is(msg.cause, input.error);
      
      return Promise.resolve();
    });

  await runServiceFromActivity({
    lambdaArn: 'test',
    activityArn: 'test',
    taskDirectory: t.context.taskDirectory,
    workDirectory: t.context.workDirectory,
    layersDirectory: t.context.layerDirectory,
    runForever: false
  });

  sfnMock.restore();
});

test.serial('Retry zip download if connection-timeout received', async(t) => {
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
    layersDirectory: t.context.layerDirectory
  });

  t.true(timeoutFailure.isDone());
  t.deepEqual(event, output);
});
