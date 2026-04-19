const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const GUESTS_TABLE = process.env.GUESTS_TABLE;

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function getUser(event) {
  const ctx = event.requestContext?.authorizer || {};
  return { userId: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role };
}

function requireAdmin(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });
  return null;
}

async function listGuests(event) {
  const denied = requireAdmin(event);
  if (denied) return denied;

  const result = await db.send(new ScanCommand({ TableName: GUESTS_TABLE }));
  const guests = (result.Items || []).sort((a, b) =>
    (a.lastName || '').localeCompare(b.lastName || ''));
  return res(200, guests);
}

async function createGuest(event) {
  const denied = requireAdmin(event);
  if (denied) return denied;

  const body = JSON.parse(event.body || '{}');
  if (!body.lastName || !body.fullName) {
    return res(400, { error: 'lastName and fullName are required' });
  }

  const user = getUser(event);
  const item = {
    guestId: crypto.randomUUID(),
    lastName: body.lastName.trim(),
    fullName: body.fullName.trim(),
    email: (body.email || '').trim(),
    phone: (body.phone || '').trim(),
    notes: (body.notes || '').trim(),
    createdAt: new Date().toISOString(),
    createdBy: user.userId,
  };

  await db.send(new PutCommand({ TableName: GUESTS_TABLE, Item: item }));
  return res(201, item);
}

async function updateGuest(id, event) {
  const denied = requireAdmin(event);
  if (denied) return denied;

  const existing = await db.send(new GetCommand({ TableName: GUESTS_TABLE, Key: { guestId: id } }));
  if (!existing.Item) return res(404, { error: 'Guest not found' });

  const body = JSON.parse(event.body || '{}');
  const user = getUser(event);
  const updated = {
    ...existing.Item,
    lastName: (body.lastName || existing.Item.lastName).trim(),
    fullName: (body.fullName || existing.Item.fullName).trim(),
    email: (body.email !== undefined ? body.email : existing.Item.email || '').trim(),
    phone: (body.phone !== undefined ? body.phone : existing.Item.phone || '').trim(),
    notes: (body.notes !== undefined ? body.notes : existing.Item.notes || '').trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: user.userId,
  };

  await db.send(new PutCommand({ TableName: GUESTS_TABLE, Item: updated }));
  return res(200, updated);
}

async function deleteGuest(id, event) {
  const denied = requireAdmin(event);
  if (denied) return denied;

  const existing = await db.send(new GetCommand({ TableName: GUESTS_TABLE, Key: { guestId: id } }));
  if (!existing.Item) return res(404, { error: 'Guest not found' });

  await db.send(new DeleteCommand({ TableName: GUESTS_TABLE, Key: { guestId: id } }));
  return res(200, { message: 'Guest deleted' });
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;
    const resource = event.resource;
    const id = event.pathParameters?.id;

    if (resource === '/guests' && method === 'GET')         return listGuests(event);
    if (resource === '/guests' && method === 'POST')        return createGuest(event);
    if (resource === '/guests/{id}' && method === 'PUT')    return updateGuest(id, event);
    if (resource === '/guests/{id}' && method === 'DELETE') return deleteGuest(id, event);

    return res(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Guests error:', err);
    return res(500, { error: 'Internal server error' });
  }
};
