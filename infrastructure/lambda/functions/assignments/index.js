const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const ASSIGNMENTS_TABLE = process.env.ASSIGNMENTS_TABLE;
const CONCERTS_TABLE = process.env.CONCERTS_TABLE;
const PREFERENCES_TABLE = process.env.PREFERENCES_TABLE;

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function getUser(event) {
  const ctx = event.requestContext?.authorizer || {};
  return { userId: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role };
}

// Fetch all assignments for a concert, organised by slotType
async function getConcertAssignments(concertId) {
  const result = await db.send(new QueryCommand({
    TableName: ASSIGNMENTS_TABLE,
    IndexName: 'concertId-index',
    KeyConditionExpression: 'concertId = :c',
    ExpressionAttributeValues: { ':c': concertId },
  }));
  return result.Items || [];
}

async function getMyAssignments(event) {
  const user = getUser(event);
  const result = await db.send(new QueryCommand({
    TableName: ASSIGNMENTS_TABLE,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': user.userId },
  }));

  // Enrich with concert details
  const assignments = result.Items || [];
  const concertIds = [...new Set(assignments.map(a => a.concertId))];
  const concerts = {};
  for (const cId of concertIds) {
    const c = await db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId: cId } }));
    if (c.Item) concerts[cId] = c.Item;
  }

  return res(200, assignments.map(a => ({
    ...a,
    concert: concerts[a.concertId] || null,
  })));
}

async function getConcertAssignmentsHandler(concertId, event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const [concert, assignments] = await Promise.all([
    db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId } })),
    getConcertAssignments(concertId),
  ]);

  if (!concert.Item) return res(404, { error: 'Concert not found' });

  // Build slot grids so admin can see empty + filled slots
  const slotTypes = ['suite', 'club', 'bsbParking', 'suiteParking'];
  const countMap = {
    suite: concert.Item.suiteTicketCount || 20,
    club: concert.Item.clubTicketCount || 10,
    bsbParking: concert.Item.bsbParkingCount || 20,
    suiteParking: concert.Item.suiteParkingCount || 8,
  };

  const slotGrids = {};
  for (const slotType of slotTypes) {
    const count = countMap[slotType];
    const assigned = assignments.filter(a => a.slotType === slotType);
    const grid = [];
    for (let i = 1; i <= count; i++) {
      const found = assigned.find(a => a.slotNumber === i);
      grid.push(found || { slotType, slotNumber: i, assignmentId: null, name: null });
    }
    slotGrids[slotType] = grid;
  }

  // Get employee requests for this concert
  const season = concert.Item.season || '2026';
  const prefsResult = await db.send(new QueryCommand({
    TableName: PREFERENCES_TABLE,
    IndexName: 'season-index',
    KeyConditionExpression: 'season = :s',
    ExpressionAttributeValues: { ':s': season },
  }));
  const requests = [];
  for (const pref of (prefsResult.Items || [])) {
    const choice = (pref.preferences || []).find(p => p.concertId === concertId);
    if (choice) {
      requests.push({
        userId: pref.userId,
        name: pref.employeeName,
        email: pref.employeeEmail,
        rank: choice.rank,
        submittedAt: pref.submittedAt,
      });
    }
  }
  requests.sort((a, b) => a.rank - b.rank || (a.name || '').localeCompare(b.name || ''));

  return res(200, {
    concert: concert.Item,
    slotGrids,
    requests,
  });
}

async function createAssignment(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const body = JSON.parse(event.body || '{}');
  const { concertId, slotType, slotNumber, assigneeType, userId: assigneeUserId, guestId, name, email, phone, notes } = body;

  if (!concertId || !slotType || !slotNumber || !name) {
    return res(400, { error: 'concertId, slotType, slotNumber, and name are required' });
  }

  const validSlotTypes = ['suite', 'club', 'bsbParking', 'suiteParking'];
  if (!validSlotTypes.includes(slotType)) {
    return res(400, { error: `slotType must be one of: ${validSlotTypes.join(', ')}` });
  }

  // Check for existing assignment at this slot
  const existing = await getConcertAssignments(concertId);
  const conflict = existing.find(a => a.slotType === slotType && a.slotNumber === slotNumber);
  if (conflict) {
    return res(409, { error: `Slot ${slotType} #${slotNumber} is already assigned to ${conflict.name}` });
  }

  const assignmentId = crypto.randomUUID();
  const item = {
    assignmentId,
    concertId,
    slotType,
    slotNumber,
    assigneeType: assigneeType || 'manual',
    userId: assigneeUserId || null,
    guestId: guestId || null,
    name,
    email: email || '',
    phone: phone || '',
    notes: notes || '',
    attended: false,
    createdAt: new Date().toISOString(),
    createdBy: user.userId,
  };

  await db.send(new PutCommand({ TableName: ASSIGNMENTS_TABLE, Item: item }));
  return res(201, item);
}

async function updateAssignment(id, event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const existing = await db.send(new GetCommand({ TableName: ASSIGNMENTS_TABLE, Key: { assignmentId: id } }));
  if (!existing.Item) return res(404, { error: 'Assignment not found' });

  const body = JSON.parse(event.body || '{}');
  const updated = {
    ...existing.Item,
    ...body,
    assignmentId: id,
    updatedAt: new Date().toISOString(),
    updatedBy: user.userId,
  };

  await db.send(new PutCommand({ TableName: ASSIGNMENTS_TABLE, Item: updated }));
  return res(200, updated);
}

async function deleteAssignment(id, event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const existing = await db.send(new GetCommand({ TableName: ASSIGNMENTS_TABLE, Key: { assignmentId: id } }));
  if (!existing.Item) return res(404, { error: 'Assignment not found' });

  await db.send(new DeleteCommand({ TableName: ASSIGNMENTS_TABLE, Key: { assignmentId: id } }));
  return res(200, { message: 'Assignment deleted' });
}

async function getAllAssignments(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const concertId = event.queryStringParameters?.concertId;
  if (concertId) {
    const items = await getConcertAssignments(concertId);
    return res(200, items);
  }
  // Full scan for reporting purposes
  const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
  const result = await db.send(new ScanCommand({ TableName: ASSIGNMENTS_TABLE }));
  return res(200, result.Items || []);
}

const crypto = require('crypto');

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;
    const resource = event.resource;
    const id = event.pathParameters?.id;

    if (resource === '/assignments/me' && method === 'GET')                  return getMyAssignments(event);
    if (resource === '/assignments/concert/{id}' && method === 'GET')        return getConcertAssignmentsHandler(id, event);
    if (resource === '/assignments' && method === 'GET')                     return getAllAssignments(event);
    if (resource === '/assignments' && method === 'POST')                    return createAssignment(event);
    if (resource === '/assignments/{id}' && method === 'PUT')                return updateAssignment(id, event);
    if (resource === '/assignments/{id}' && method === 'DELETE')             return deleteAssignment(id, event);

    return res(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Assignments error:', err);
    return res(500, { error: 'Internal server error' });
  }
};
