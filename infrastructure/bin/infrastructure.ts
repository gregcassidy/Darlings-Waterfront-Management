#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack';
import { StorageStack } from '../lib/storage-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

const env = {
  account: '119002863133',
  region: 'us-east-1',
};

const dbStack = new DatabaseStack(app, 'DarlingsWaterfrontDbStack', { env });
const storageStack = new StorageStack(app, 'DarlingsWaterfrontStorageStack', { env });
const apiStack = new ApiStack(app, 'DarlingsWaterfrontApiStack', {
  env,
  tables: dbStack.tables,
});
new FrontendStack(app, 'DarlingsWaterfrontFrontendStack', {
  env,
  bucket: storageStack.bucket,
  api: apiStack.api,
});
