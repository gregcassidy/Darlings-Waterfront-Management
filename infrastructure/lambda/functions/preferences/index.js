const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const DEALERSHIPS = [
  'Ford VW Audi', 'Honda Nissan Volvo', 'Kia', 'Value Center', 'CVC',
  'Corporate', 'Agency', 'Greenpoint', 'Automall', 'Chevy',
  '44 Downeast', 'Newport', 'Augusta', 'Brunswick',
];

const PREFERENCES_TABLE = process.env.PREFERENCES_TABLE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE;
const SETTINGS_TABLE = process.env.SETTINGS_TABLE;
const CONCERTS_TABLE = process.env.CONCERTS_TABLE;
const ASSIGNMENTS_TABLE = process.env.ASSIGNMENTS_TABLE;

const NEW_EMPLOYEE_GRACE_DAYS = 21;

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function getUser(event) {
  const ctx = event.requestContext?.authorizer || {};
  return { userId: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role };
}

async function getSubmissionsStatus() {
  const newKey = await db.send(new GetCommand({
    TableName: SETTINGS_TABLE, Key: { settingKey: 'submissionsStatus' },
  }));
  if (newKey.Item?.value) return newKey.Item.value;
  // Fallback to legacy boolean key
  const legacy = await db.send(new GetCommand({
    TableName: SETTINGS_TABLE, Key: { settingKey: 'submissionsOpen' },
  }));
  return legacy.Item?.value === 'true' ? 'open' : 'closed';
}

function isWithinNewEmployeeGrace(employeeRecord) {
  if (!employeeRecord?.createdAt) return true; // no record yet = first-time user
  const ageMs = Date.now() - new Date(employeeRecord.createdAt).getTime();
  return ageMs < NEW_EMPLOYEE_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

function getEffectiveMode(systemStatus, employeeRecord) {
  if (employeeRecord?.canEditFreely) return 'open';
  if (isWithinNewEmployeeGrace(employeeRecord)) return 'open';
  return systemStatus;
}

// Limited mode = "one swap": allow at most one concert added and at most one removed
// (so a swap counts as add 1 + remove 1 = ok). Reordering existing picks is not allowed.
// Removed concert must not have happened or be assigned. Added concert must exist and
// not be cancelled.
async function validateLimitedSwap(userId, season, newPrefs) {
  const existing = await db.send(new GetCommand({
    TableName: PREFERENCES_TABLE, Key: { userId, season },
  }));
  const oldPrefs = existing.Item?.preferences || [];

  const oldIds = new Set(oldPrefs.map(p => p.concertId));
  const newIds = new Set(newPrefs.map(p => p.concertId));
  const added = [...newIds].filter(id => !oldIds.has(id));
  const removed = [...oldIds].filter(id => !newIds.has(id));

  if (added.length > 1 || removed.length > 1) {
    return { ok: false, error: 'In limited mode you can only change one selection at a time.' };
  }

  // No reordering: if the sets match, the rank order must match too
  if (added.length === 0 && removed.length === 0) {
    const oldByRank = {}; for (const p of oldPrefs) oldByRank[p.rank] = p.concertId;
    const newByRank = {}; for (const p of newPrefs) newByRank[p.rank] = p.concertId;
    for (const r of [1, 2, 3, 4, 5]) {
      if ((oldByRank[r] || null) !== (newByRank[r] || null)) {
        return { ok: false, error: 'In limited mode you cannot reorder existing selections.' };
      }
    }
    return { ok: true };
  }

  if (removed.length === 1) {
    const removedId = removed[0];
    const oldConcert = await db.send(new GetCommand({
      TableName: CONCERTS_TABLE, Key: { concertId: removedId },
    }));
    if (oldConcert.Item) {
      const today = new Date().toISOString().slice(0, 10);
      if (oldConcert.Item.date && oldConcert.Item.date < today) {
        return { ok: false, error: `Cannot change "${oldConcert.Item.name}" — that concert has already taken place.` };
      }
    }
    const assignmentsResult = await db.send(new QueryCommand({
      TableName: ASSIGNMENTS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': userId },
    }));
    const hasTicket = (assignmentsResult.Items || []).some(a => a.concertId === removedId);
    if (hasTicket) {
      const concertName = oldConcert.Item?.name || removedId;
      return { ok: false, error: `Cannot change "${concertName}" — you have already been assigned tickets to it.` };
    }
  }

  if (added.length === 1) {
    const addedId = added[0];
    const newConcert = await db.send(new GetCommand({
      TableName: CONCERTS_TABLE, Key: { concertId: addedId },
    }));
    if (!newConcert.Item) return { ok: false, error: `Concert not found: ${addedId}` };
    if (newConcert.Item.status === 'cancelled') {
      return { ok: false, error: `"${newConcert.Item.name}" is cancelled and cannot be selected.` };
    }
  }

  return { ok: true };
}

async function getCurrentSeason() {
  const result = await db.send(new GetCommand({
    TableName: SETTINGS_TABLE,
    Key: { settingKey: 'currentSeason' },
  }));
  return result.Item?.value || '2026';
}

async function ensureEmployeeRecord(user, extraFields = {}) {
  const existing = await db.send(new GetCommand({ TableName: EMPLOYEES_TABLE, Key: { userId: user.userId } }));
  const now = new Date().toISOString();
  await db.send(new PutCommand({
    TableName: EMPLOYEES_TABLE,
    Item: {
      ...(existing.Item || {}),
      userId: user.userId,
      workEmail: user.email,
      displayName: user.name,
      isAdmin: user.role === 'admin',
      createdAt: existing.Item?.createdAt || now,
      updatedAt: now,
      ...extraFields,
    },
  }));
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

  // Look up current employee record + system mode to compute the user's effective mode
  const empResult = await db.send(new GetCommand({ TableName: EMPLOYEES_TABLE, Key: { userId: user.userId } }));
  const employeeRecord = empResult.Item;
  const systemStatus = await getSubmissionsStatus();
  const effectiveMode = user.role === 'admin' ? 'open' : getEffectiveMode(systemStatus, employeeRecord);

  if (effectiveMode === 'closed') {
    return res(403, { error: 'Submissions are currently closed.' });
  }

  const preferences = body.preferences || [];
  if (preferences.length === 0) return res(400, { error: 'At least one preference is required' });
  if (preferences.length > 5) return res(400, { error: 'Maximum 5 preferences allowed' });

  const ranks = preferences.map(p => p.rank);
  const concertIds = preferences.map(p => p.concertId);

  if (new Set(ranks).size !== ranks.length) return res(400, { error: 'Duplicate ranks are not allowed' });
  if (new Set(concertIds).size !== concertIds.length) return res(400, { error: 'Duplicate concert selections are not allowed' });
  if (ranks.some(r => r < 1 || r > 5)) return res(400, { error: 'Ranks must be between 1 and 5' });

  // Build set of concertIds from existing prefs so users keeping a stale cancelled
  // entry while swapping a different rank don't get blocked by the cancelled-check.
  const existingPrefs = await db.send(new GetCommand({
    TableName: PREFERENCES_TABLE, Key: { userId: user.userId, season },
  }));
  const existingConcertIds = new Set((existingPrefs.Item?.preferences || []).map(p => p.concertId));

  for (const concertId of concertIds) {
    const concert = await db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId } }));
    if (!concert.Item) return res(400, { error: `Concert not found: ${concertId}` });
    if (concert.Item.season !== season) return res(400, { error: `Concert ${concertId} is not in the current season` });
    if (concert.Item.status === 'cancelled' && !existingConcertIds.has(concertId)) {
      return res(400, { error: `"${concert.Item.name}" is cancelled and cannot be selected.` });
    }
  }

  if (effectiveMode === 'limited') {
    const validation = await validateLimitedSwap(user.userId, season, preferences);
    if (!validation.ok) return res(400, { error: validation.error });
  }

  await ensureEmployeeRecord(user);

  const personalEmail = (body.personalEmail || '').trim().toLowerCase();
  if (!personalEmail) return res(400, { error: 'personalEmail is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
    return res(400, { error: 'personalEmail must be a valid email address' });
  }

  const profile = body.profile || {};
  await ensureEmployeeRecord(user, {
    firstName: profile.givenName || '',
    lastName: profile.surname || '',
    jobTitle: profile.jobTitle || '',
    officeLocation: profile.officeLocation || '',
    ...(profile.companyName !== undefined && { location: profile.companyName }),
    businessPhone: (profile.businessPhones || [])[0] || '',
    personalEmail,
  });

  const item = {
    userId: user.userId,
    season,
    preferences: preferences.sort((a, b) => a.rank - b.rank),
    employeeName: user.name,
    employeeEmail: user.email,
    personalEmail,
    submittedAt: new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: PREFERENCES_TABLE, Item: item }));
  return res(200, item);
}

async function submitExternalPreferences(event) {
  const body = JSON.parse(event.body || '{}');
  const season = await getCurrentSeason();

  // Public submitters are always treated as fresh entries (no swap concept). Block only
  // when the system is fully closed.
  const status = await getSubmissionsStatus();
  if (status === 'closed') return res(403, { error: 'Submissions are currently closed.' });

  const firstName = (body.firstName || '').trim();
  const lastName = (body.lastName || '').trim();
  const phone = (body.phone || '').trim();
  const location = (body.location || '').trim();
  const email = (body.email || '').trim().toLowerCase();

  if (!firstName) return res(400, { error: 'First name is required' });
  if (!lastName) return res(400, { error: 'Last name is required' });
  if (!phone) return res(400, { error: 'Phone number is required' });
  if (!location) return res(400, { error: 'Location is required' });
  if (!DEALERSHIPS.includes(location)) return res(400, { error: 'Invalid location' });
  if (!email) return res(400, { error: 'Email is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res(400, { error: 'Invalid email address' });
  }

  const preferences = body.preferences || [];
  if (preferences.length === 0) return res(400, { error: 'At least one preference is required' });
  if (preferences.length > 5) return res(400, { error: 'Maximum 5 preferences allowed' });

  const ranks = preferences.map(p => p.rank);
  const concertIds = preferences.map(p => p.concertId);
  if (new Set(ranks).size !== ranks.length) return res(400, { error: 'Duplicate ranks are not allowed' });
  if (new Set(concertIds).size !== concertIds.length) return res(400, { error: 'Duplicate concert selections are not allowed' });
  if (ranks.some(r => r < 1 || r > 5)) return res(400, { error: 'Ranks must be between 1 and 5' });

  for (const concertId of concertIds) {
    const concert = await db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId } }));
    if (!concert.Item) return res(400, { error: `Concert not found: ${concertId}` });
    if (concert.Item.season !== season) return res(400, { error: `Concert ${concertId} is not in the current season` });
    if (concert.Item.status === 'cancelled') {
      return res(400, { error: `"${concert.Item.name}" is cancelled and cannot be selected.` });
    }
  }

  const userId = `external-${crypto.randomUUID()}`;
  const fullName = `${firstName} ${lastName}`.trim();
  const item = {
    userId,
    season,
    preferences: preferences.sort((a, b) => a.rank - b.rank),
    employeeName: fullName,
    employeeEmail: email,
    firstName,
    lastName,
    phone,
    location,
    submissionType: 'external',
    submittedAt: new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: PREFERENCES_TABLE, Item: item }));
  return res(200, { ok: true, submittedAt: item.submittedAt });
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

async function getMyProfile(event) {
  const user = getUser(event);
  const result = await db.send(new GetCommand({ TableName: EMPLOYEES_TABLE, Key: { userId: user.userId } }));
  const profile = result.Item || { userId: user.userId, workEmail: user.email, displayName: user.name };
  // Always include the live role from the authorizer context so the frontend can trust it
  return res(200, { ...profile, role: user.role });
}

async function updateMyProfile(event) {
  const user = getUser(event);
  const body = JSON.parse(event.body || '{}');

  const personalEmail = body.personalEmail !== undefined
    ? (body.personalEmail || '').trim().toLowerCase() : undefined;

  if (personalEmail !== undefined && personalEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
    return res(400, { error: 'personalEmail must be a valid email address' });
  }

  const extraFields = {
    ...(body.givenName !== undefined    && { firstName: body.givenName }),
    ...(body.surname !== undefined      && { lastName: body.surname }),
    ...(body.displayName !== undefined  && { displayName: body.displayName }),
    ...(body.jobTitle !== undefined     && { jobTitle: body.jobTitle }),
    ...(body.officeLocation !== undefined && { officeLocation: body.officeLocation }),
    ...(body.companyName !== undefined  && { location: body.companyName }),
    ...(body.businessPhones !== undefined && { businessPhone: (body.businessPhones || [])[0] || '' }),
    ...(personalEmail !== undefined     && { personalEmail }),
  };

  await ensureEmployeeRecord(user, extraFields);
  const updated = await db.send(new GetCommand({ TableName: EMPLOYEES_TABLE, Key: { userId: user.userId } }));
  return res(200, updated.Item);
}

async function getAllEmployees(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  // Include admins — they may also be ticket-holding employees (most of Darling's
  // is set up that way), and the concert detail UI uses this map to enrich rows.
  const result = await db.send(new ScanCommand({ TableName: EMPLOYEES_TABLE }));
  const employees = (result.Items || [])
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  return res(200, employees);
}

async function getAllSubmissions(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const season = event.queryStringParameters?.season || await getCurrentSeason();

  const [prefsResult, empsResult, assignmentsResult, concertsResult] = await Promise.all([
    db.send(new QueryCommand({
      TableName: PREFERENCES_TABLE,
      IndexName: 'season-index',
      KeyConditionExpression: 'season = :s',
      ExpressionAttributeValues: { ':s': season },
    })),
    db.send(new ScanCommand({ TableName: EMPLOYEES_TABLE })),
    db.send(new ScanCommand({ TableName: ASSIGNMENTS_TABLE })),
    db.send(new QueryCommand({
      TableName: CONCERTS_TABLE,
      IndexName: 'season-date-index',
      KeyConditionExpression: 'season = :s',
      ExpressionAttributeValues: { ':s': season },
    })),
  ]);

  const employeeMap = {};
  for (const e of (empsResult.Items || [])) employeeMap[e.userId] = e;

  const concertMap = {};
  for (const c of (concertsResult.Items || [])) concertMap[c.concertId] = c;

  // Compose key on userId|concertId so the spreadsheet can mark assigned/attended cells
  const assignmentMap = {};
  for (const a of (assignmentsResult.Items || [])) {
    if (a.userId && concertMap[a.concertId]) {
      assignmentMap[`${a.userId}|${a.concertId}`] = a;
    }
  }

  const buildChoices = (preferences, userId) => {
    const out = [];
    for (let rank = 1; rank <= 5; rank++) {
      const cp = (preferences || []).find(p => p.rank === rank);
      if (!cp) { out.push({ rank, concertId: null }); continue; }
      const concert = concertMap[cp.concertId];
      const assignment = assignmentMap[`${userId}|${cp.concertId}`];
      out.push({
        rank,
        concertId: cp.concertId,
        concertName: concert?.name || '(unknown)',
        concertDate: concert?.date || '',
        concertStatus: concert?.status || 'active',
        assigned: !!assignment,
        attended: !!assignment?.attended,
        slotType: assignment?.slotType || null,
        slotNumber: assignment?.slotNumber || null,
      });
    }
    return out;
  };

  const seenUserIds = new Set();
  const submissions = [];

  for (const pref of (prefsResult.Items || [])) {
    seenUserIds.add(pref.userId);
    const isExternal = pref.submissionType === 'external';
    const emp = employeeMap[pref.userId];
    let lastName = '', firstName = '', location = '', displayName = '';
    if (isExternal) {
      lastName    = pref.lastName  || '';
      firstName   = pref.firstName || '';
      location    = pref.location  || '';
      displayName = pref.employeeName || `${firstName} ${lastName}`.trim();
    } else if (emp) {
      lastName    = emp.lastName       || '';
      firstName   = emp.firstName      || '';
      location    = emp.location       || '';   // admin-set dealership; Graph officeLocation is junk (extension numbers)
      displayName = emp.displayName    || pref.employeeName || '';
    } else {
      const parts = (pref.employeeName || '').split(' ');
      firstName   = parts[0] || '';
      lastName    = parts.slice(1).join(' ') || '';
      displayName = pref.employeeName || '';
    }
    submissions.push({
      userId: pref.userId,
      submissionType: isExternal ? 'external' : 'employee',
      lastName, firstName, displayName, location,
      canEditFreely: !!emp?.canEditFreely,
      submittedAt: pref.submittedAt || null,
      choices: buildChoices(pref.preferences, pref.userId),
    });
  }

  // Include employees with records but no submission yet
  for (const emp of (empsResult.Items || [])) {
    if (seenUserIds.has(emp.userId)) continue;
    submissions.push({
      userId: emp.userId,
      submissionType: 'employee',
      lastName: emp.lastName || '',
      firstName: emp.firstName || '',
      displayName: emp.displayName || '',
      location: emp.location || '',
      canEditFreely: !!emp.canEditFreely,
      submittedAt: null,
      choices: buildChoices([], emp.userId),
    });
  }

  return res(200, { season, submissions, dealerships: DEALERSHIPS });
}

async function adminUpdateEmployee(targetUserId, event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const body = JSON.parse(event.body || '{}');
  const existing = await db.send(new GetCommand({ TableName: EMPLOYEES_TABLE, Key: { userId: targetUserId } }));
  if (!existing.Item) return res(404, { error: 'Employee not found' });

  const updated = { ...existing.Item, updatedAt: new Date().toISOString() };
  if (body.canEditFreely !== undefined) updated.canEditFreely = !!body.canEditFreely;
  if (body.location !== undefined) {
    // Don't enforce DEALERSHIPS allow-list here — Entra companyName may use slightly
    // different wording, and the admin should be able to keep whatever is correct
    updated.location = (body.location || '').toString().trim();
  }

  await db.send(new PutCommand({ TableName: EMPLOYEES_TABLE, Item: updated }));
  return res(200, updated);
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

    if (resource === '/public/preferences' && method === 'POST')   return submitExternalPreferences(event);
    if (resource === '/preferences/me' && method === 'GET')        return getMyPreferences(event);
    if (resource === '/preferences' && method === 'POST')          return submitPreferences(event);
    if (resource === '/preferences' && method === 'GET')           return getAllPreferences(event);
    if (resource === '/preferences/{userId}' && method === 'GET')  return getUserPreferences(userId, event);
    if (resource === '/employees/me' && method === 'GET')          return getMyProfile(event);
    if (resource === '/employees/me' && method === 'PUT')          return updateMyProfile(event);
    if (resource === '/employees' && method === 'GET')             return getAllEmployees(event);
    if (resource === '/employees/{userId}' && method === 'PUT')    return adminUpdateEmployee(userId, event);
    if (resource === '/admin/all-submissions' && method === 'GET') return getAllSubmissions(event);

    return res(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Preferences error:', err);
    return res(500, { error: 'Internal server error' });
  }
};
