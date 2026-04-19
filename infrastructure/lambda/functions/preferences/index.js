const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const PREFERENCES_TABLE = process.env.PREFERENCES_TABLE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE;
const SETTINGS_TABLE = process.env.SETTINGS_TABLE;
const CONCERTS_TABLE = process.env.CONCERTS_TABLE;

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function getUser(event) {
  const ctx = event.requestContext?.authorizer || {};
  return { userId: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role };
}

async function isSubmissionsOpen() {
  const result = await db.send(new GetCommand({
    TableName: SETTINGS_TABLE,
    Key: { settingKey: 'submissionsOpen' },
  }));
  return result.Item?.value === 'true';
}

async function getCurrentSeason() {
  const result = await db.send(new GetCommand({
    TableName: SETTINGS_TABLE,
    Key: { settingKey: 'currentSeason' },
  }));
  return result.Item?.value || '2026';
}

async function ensureEmployeeRecord(user) {
  try {
    await db.send(new PutCommand({
      TableName: EMPLOYEES_TABLE,
      Item: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        isAdmin: user.role === 'admin',
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(userId)',
    }));
  } catch (err) {
    // ConditionalCheckFailedException = employee already exists, ignore
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

async function getMyPreferences(event) {
  const user = getUser(event);
  const season = await getCurrentSeason();

  const result = await db.send(new GetCommand({
    TableName: PREFERENCES_TABLE,
    Key: { userId: user.userId, season },
  }));

  return res(200, result.Item || { userId: user.userId, season, preferences: [] });
}

async function submitPreferences(event) {
  const user = getUser(event);
  const body = JSON.parse(event.body || '{}');
  const season = await getCurrentSeason();

  const open = await isSubmissionsOpen();
  if (!open && user.role !== 'admin') {
    return res(403, { error: 'Submissions are currently closed' });
  }

  const preferences = body.preferences || [];
  if (preferences.length === 0) return res(400, { error: 'At least one preference is required' });
  if (preferences.length > 5) return res(400, { error: 'Maximum 5 preferences allowed' });

  const ranks = preferences.map(p => p.rank);
  const concertIds = preferences.map(p => p.concertId);

  if (new Set(ranks).size !== ranks.length) return res(400, { error: 'Duplicate ranks are not allowed' });
  if (new Set(concertIds).size !== concertIds.length) return res(400, { error: 'Duplicate concert selections are not allowed' });
  if (ranks.some(r => r < 1 || r > 5)) return res(400, { error: 'Ranks must be between 1 and 5' });

  // Verify all concertIds exist in the current season
  for (const concertId of concertIds) {
    const concert = await db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId } }));
    if (!concert.Item) return res(400, { error: `Concert not found: ${concertId}` });
    if (concert.Item.season !== season) return res(400, { error: `Concert ${concertId} is not in the current season` });
  }

  await ensureEmployeeRecord(user);

  const item = {
    userId: user.userId,
    season,
    preferences: preferences.sort((a, b) => a.rank - b.rank),
    employeeName: user.name,
    employeeEmail: user.email,
    submittedAt: new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: PREFERENCES_TABLE, Item: item }));
  return res(200, item);
}

async function getAllPreferences(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const season = event.queryStringParameters?.season || await getCurrentSeason();
  const result = await db.send(new QueryCommand({
    TableName: PREFERENCES_TABLE,
    IndexName: 'season-index',
    KeyConditionExpression: 'season = :s',
    ExpressionAttributeValues: { ':s': season },
  }));

  const items = (result.Items || []).sort((a, b) =>
    (a.employeeName || '').localeCompare(b.employeeName || ''));
  return res(200, items);
}

async function getUserPreferences(userId, event) {
  const user = getUser(event);
  if (user.role !== 'admin' && user.userId !== userId) {
    return res(403, { error: 'Forbidden' });
  }

  const season = event.queryStringParameters?.season || await getCurrentSeason();
  const result = await db.send(new GetCommand({
    TableName: PREFERENCES_TABLE,
    Key: { userId, season },
  }));

  return res(200, result.Item || { userId, season, preferences: [] });
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;
    const resource = event.resource;
    const userId = event.pathParameters?.userId;

    if (resource === '/preferences/me' && method === 'GET')        return getMyPreferences(event);
    if (resource === '/preferences' && method === 'POST')          return submitPreferences(event);
    if (resource === '/preferences' && method === 'GET')           return getAllPreferences(event);
    if (resource === '/preferences/{userId}' && method === 'GET')  return getUserPreferences(userId, event);

    return res(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Preferences error:', err);
    return res(500, { error: 'Internal server error' });
  }
};
