const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const crypto = require('crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const ssm = new SSMClient({});

// Graph app secret, resolved from SSM (SecureString) and cached across warm invocations.
// Falls back to the legacy AZURE_CLIENT_SECRET env var if it's still set.
let _azureSecretCache = null;
async function getAzureClientSecret() {
  if (process.env.AZURE_CLIENT_SECRET) return process.env.AZURE_CLIENT_SECRET;
  if (_azureSecretCache) return _azureSecretCache;
  const name = process.env.AZURE_CLIENT_SECRET_PARAM;
  if (!name) return null;
  try {
    const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    _azureSecretCache = out.Parameter?.Value || null;
    return _azureSecretCache;
  } catch (e) {
    console.error('Failed to read Azure client secret from SSM:', e.message);
    return null;
  }
}

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

// Delete every assignment held by a user (frees their ticket/parking slots) and
// return a summary of what was freed, enriched with concert name/date for the UI.
async function clearUserAssignments(userId) {
  const result = await db.send(new QueryCommand({
    TableName: ASSIGNMENTS_TABLE,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId },
  }));
  const items = result.Items || [];
  for (const a of items) {
    await db.send(new DeleteCommand({ TableName: ASSIGNMENTS_TABLE, Key: { assignmentId: a.assignmentId } }));
  }

  const concertIds = [...new Set(items.map(a => a.concertId))];
  const concertMap = {};
  for (const cId of concertIds) {
    const c = await db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId: cId } }));
    if (c.Item) concertMap[cId] = c.Item;
  }
  return items.map(a => ({
    concertId: a.concertId,
    slotType: a.slotType,
    slotNumber: a.slotNumber,
    concertName: concertMap[a.concertId]?.name || a.concertId,
    concertDate: concertMap[a.concertId]?.date || '',
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

  if (employeeRecord?.isTerminated) {
    return res(403, { error: 'This account has been deactivated. Please contact an administrator.' });
  }

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
    .filter(e => !e.isTerminated)
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  return res(200, employees);
}

async function getAllSubmissions(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const season = event.queryStringParameters?.season || await getCurrentSeason();
  const includeTerminated = event.queryStringParameters?.includeTerminated === '1';

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

  // Compose key on userId|concertId. An employee may have multiple assignments
  // for one concert (paired tickets, or ticket+parking), so collect them all.
  const assignmentMap = {};
  for (const a of (assignmentsResult.Items || [])) {
    if (a.userId && concertMap[a.concertId]) {
      const key = `${a.userId}|${a.concertId}`;
      (assignmentMap[key] = assignmentMap[key] || []).push(a);
    }
  }

  const buildChoices = (preferences, userId) => {
    const out = [];
    for (let rank = 1; rank <= 5; rank++) {
      const cp = (preferences || []).find(p => p.rank === rank);
      if (!cp) { out.push({ rank, concertId: null }); continue; }
      const concert = concertMap[cp.concertId];
      const all = (assignmentMap[`${userId}|${cp.concertId}`] || []).slice()
        .sort((a, b) =>
          (a.slotType || '').localeCompare(b.slotType || '')
          || ((a.slotNumber || 0) - (b.slotNumber || 0)));
      out.push({
        rank,
        concertId: cp.concertId,
        concertName: concert?.name || '(unknown)',
        concertDate: concert?.date || '',
        concertStatus: concert?.status || 'active',
        assigned: all.length > 0,
        attended: all.length > 0 && all.every(x => x.attended),
        // Backward-compat: first assignment surfaced as slotType/slotNumber
        slotType: all[0]?.slotType || null,
        slotNumber: all[0]?.slotNumber || null,
        // Full list, used by the spreadsheet to render multi-slot badges
        assignments: all.map(x => ({
          slotType: x.slotType,
          slotNumber: x.slotNumber,
          attended: !!x.attended,
        })),
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
    if (!isExternal && emp?.isTerminated && !includeTerminated) continue;
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
      isTerminated: !!emp?.isTerminated,
      submittedAt: pref.submittedAt || null,
      choices: buildChoices(pref.preferences, pref.userId),
    });
  }

  // Include employees with records but no submission yet
  for (const emp of (empsResult.Items || [])) {
    if (seenUserIds.has(emp.userId)) continue;
    if (emp.isTerminated && !includeTerminated) continue;
    submissions.push({
      userId: emp.userId,
      submissionType: 'employee',
      lastName: emp.lastName || '',
      firstName: emp.firstName || '',
      displayName: emp.displayName || '',
      location: emp.location || '',
      canEditFreely: !!emp.canEditFreely,
      isTerminated: !!emp.isTerminated,
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

  // Termination toggle. Flipping ON frees the employee's held slots (assignments are
  // deleted, not archived — reinstating does NOT restore them; the admin reassigns).
  let freedSlots = [];
  if (body.isTerminated !== undefined) {
    const nowTerminated = !!body.isTerminated;
    const wasTerminated = !!existing.Item.isTerminated;
    updated.isTerminated = nowTerminated;
    if (nowTerminated && !wasTerminated) {
      updated.terminatedAt = new Date().toISOString();
      updated.terminatedBy = user.userId;
      updated.terminationSource = body.terminationSource === 'entra' ? 'entra' : 'manual';
      freedSlots = await clearUserAssignments(targetUserId);
    } else if (!nowTerminated && wasTerminated) {
      delete updated.terminatedAt;
      delete updated.terminatedBy;
      delete updated.terminationSource;
    }
  }

  await db.send(new PutCommand({ TableName: EMPLOYEES_TABLE, Item: updated }));
  return res(200, { ...updated, freedSlots });
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

// ── Entra (Azure AD) auto-sync ─────────────────────────────
// Acquire an app-only Graph token via the client-credentials flow. Requires the
// app registration to hold the `User.Read.All` application permission (admin
// consent) and the secret to be present in SSM. Returns null when unconfigured.
async function getGraphAppToken() {
  const tenant = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = await getAzureClientSecret();
  if (!clientSecret || !tenant || !clientId || tenant.startsWith('REPLACE')) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!resp.ok) {
    console.error('Graph token request failed:', resp.status, await resp.text());
    return null;
  }
  const data = await resp.json();
  return data.access_token || null;
}

// Check each known employee's Entra account status and terminate any whose account
// is disabled or deleted. Manual terminations are left untouched.
async function syncTerminations(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const token = await getGraphAppToken();
  if (!token) {
    return res(503, {
      error: 'Entra sync is not configured. Store the Graph app secret in SSM and grant the app the User.Read.All application permission with admin consent.',
    });
  }

  const empsResult = await db.send(new ScanCommand({ TableName: EMPLOYEES_TABLE }));
  const candidates = (empsResult.Items || []).filter(e =>
    !e.isTerminated && e.userId && !e.userId.startsWith('external-') && !e.userId.startsWith('dev-'));

  // Resolve account status via Graph's $batch endpoint (max 20 sub-requests each),
  // run in parallel so hundreds of employees resolve in a couple of seconds rather
  // than timing out the way one-request-per-employee did.
  const chunks = [];
  for (let i = 0; i < candidates.length; i += 20) chunks.push(candidates.slice(i, i + 20));

  const errors = [];
  const statusByUser = {};
  const batchResults = await Promise.all(chunks.map(async (chunk) => {
    try {
      const requests = chunk.map((emp, idx) => ({
        id: String(idx),
        method: 'GET',
        url: `/users/${encodeURIComponent(emp.userId)}?$select=id,accountEnabled`,
      }));
      const resp = await fetch('https://graph.microsoft.com/v1.0/$batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        return { chunk, error: `Graph $batch failed: ${resp.status} ${text.slice(0, 200)}` };
      }
      return { chunk, data: await resp.json() };
    } catch (e) {
      return { chunk, error: e.message };
    }
  }));

  for (const br of batchResults) {
    if (br.error) {
      for (const emp of br.chunk) errors.push({ userId: emp.userId, error: br.error });
      continue;
    }
    for (const r of (br.data.responses || [])) {
      const emp = br.chunk[parseInt(r.id, 10)];
      if (!emp) continue;
      if (r.status === 404) statusByUser[emp.userId] = 'deleted';
      else if (r.status >= 200 && r.status < 300) {
        statusByUser[emp.userId] = (r.body && r.body.accountEnabled === false) ? 'disabled' : 'active';
      } else {
        errors.push({ userId: emp.userId, status: r.status });
      }
    }
  }

  // Only the matched (disabled/deleted) accounts touch DynamoDB — typically a handful.
  const terminated = [];
  for (const emp of candidates) {
    const st = statusByUser[emp.userId];
    if (st !== 'disabled' && st !== 'deleted') continue;
    const now = new Date().toISOString();
    await db.send(new PutCommand({
      TableName: EMPLOYEES_TABLE,
      Item: { ...emp, isTerminated: true, terminatedAt: now, terminatedBy: user.userId, terminationSource: 'entra', updatedAt: now },
    }));
    const freedSlots = await clearUserAssignments(emp.userId);
    terminated.push({ userId: emp.userId, displayName: emp.displayName || '', reason: st, freedSlots });
  }

  return res(200, { checked: candidates.length, terminatedCount: terminated.length, terminated, errors });
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
    if (resource === '/admin/sync-terminations' && method === 'POST') return syncTerminations(event);

    return res(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Preferences error:', err);
    return res(500, { error: 'Internal server error' });
  }
};
