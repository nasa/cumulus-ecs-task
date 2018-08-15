/* eslint-disable no-param-reassign */
'use strict';

import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import test from 'ava';
import nock from 'nock';
import sinon from 'sinon';
import AWS from 'aws-sdk';
import archiver from 'archiver';
import { runTask, runServiceFromActivity, runServiceFromSQS } from '../index';


test.beforeEach(async (t) => {
  t.context.tempDir = path.join(os.tmpdir(), 'cumulus-ecs-task', `${Date.now()}`, path.sep);
  fs.mkdirpSync(t.context.tempDir);
  t.context.lambdaZip = path.join(t.context.tempDir, 'remoteLambda.zip');

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

  nock('https://example.com')
    .get('/lambda')
    .reply(200, () => fs.createReadStream(t.context.lambdaZip));

  t.context.expectedOutput = [
    'fakeLambda',
    'handler'
  ];
  t.context.stub = sinon.stub(AWS, 'Lambda')
    .returns({
      getFunction: () => ({
        promise: async () => ({
          Code: {
            Location: 'https://example.com/lambda'
          },
          Configuration: {
            Handler: t.context.expectedOutput.join('.')
          }
        })
      })
    });
});

test.afterEach.always((t) => {
  t.context.stub.restore();
  fs.removeSync(t.context.tempDir);
});

test.serial('test successful task run', async (t) => {
  const event = { hi: 'bye' };
  const taskDirectory = path.join(t.context.tempDir, 'task');
  const workDirectory = path.join(t.context.tempDir, '.tmp-work');
  fs.mkdirpSync(taskDirectory);
  fs.mkdirpSync(workDirectory);

  const output = await runTask({
    lambdaArn: 'fakearn',
    lambdaInput: event,
    taskDirectory,
    workDirectory
  });

  t.deepEqual(event, output);
});

// test.serial('test failed invoke', async (t) => {
//   const event = { hi: 'bye', error: 'it failed' };
//   const promise = awa(event, 'fake', t.context.tempDir);
//   const error = await t.throws(promise);
//   t.is(error, event.error);
// });
