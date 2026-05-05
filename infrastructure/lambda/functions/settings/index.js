const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const SETTINGS_TABLE = process.env.SETTINGS_TABLE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE;

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function getUser(event) {
  const ctx = event.requestContext?.authorizer || {};
  return { userId: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role };
}

const ALLOWED_KEYS = ['submissionsStatus', 'submissionsOpen', 'currentSeason', 'notificationFromEmail'];
const SUBMISSION_STATUSES = ['open', 'limited', 'closed'];

async function getSettings(event) {
  const result = await db.send(new ScanCommand({ TableName: SETTINGS_TABLE }));
  const settings = {};
  for (const item of (result.Items || [])) {
    settings[item.settingKey] = item.value;
  }
  // Defaults + backward-compat
  if (!settings.submissionsStatus) {
    settings.submissionsStatus = settings.submissionsOpen === 'true' ? 'open' : 'closed';
  }
  // Keep legacy key in sync for any older clients still reading it
  settings.submissionsOpen = settings.submissionsStatus === 'closed' ? 'false' : 'true';
  if (!settings.currentSeason) settings.currentSeason = '2026';
  if (!settings.notificationFromEmail) settings.notificationFromEmail = '';
  return res(200, settings);
}

async function updateSetting(key, event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  if (!ALLOWED_KEYS.includes(key)) {
    return res(400, { error: `Invalid setting key. Allowed: ${ALLOWED_KEYS.join(', ')}` });
  }

  const body = JSON.parse(event.body || '{}');
  if (body.value === undefined) return res(400, { error: 'value is required' });

  if (key === 'submissionsStatus' && !SUBMISSION_STATUSES.includes(String(body.value))) {
    return res(400, { error: `submissionsStatus must be one of: ${SUBMISSION_STATUSES.join(', ')}` });
  }
  if (key === 'submissionsOpen' && !['true', 'false'].includes(String(body.value))) {
    return res(400, { error: 'submissionsOpen must be "true" or "false"' });
  }

  await db.send(new PutCommand({
    TableName: SETTINGS_TABLE,
    Item: {
      settingKey: key,
      value: String(body.value),
      updatedAt: new Date().toISOString(),
      updatedBy: user.userId,
    },
  }));

  return res(200, { settingKey: key, value: String(body.value) });
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;
    const resource = event.resource;
    const key = event.pathParameters?.key;

    if (resource === '/settings' && method === 'GET')         return getSettings(event);
    if (resource === '/settings/{key}' && method === 'PUT')   return updateSetting(key, event);

    return res(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Settings error:', err);
    return res(500, { error: 'Internal server error' });
  }
};
