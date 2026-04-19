const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

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

// 2026 season concert data from admin's spreadsheet
const SEED_CONCERTS_2026 = [
  { showNumber: 1,  name: 'MGK w/Wiz Khalifa - Lost American Tour',                               day: 'Friday',    date: '2026-06-05', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 2,  name: "Kid Cudi w/M.I.A. & BIG BOI - The Rebel Ragers Tour",                 day: 'Saturday',  date: '2026-06-06', doorsTime: '5:00 PM', musicTime: '6:30 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 3,  name: 'Mumford & Sons Prizefighter w/Dylan Gossett',                           day: 'Tuesday',   date: '2026-06-16', doorsTime: '4:30 PM', musicTime: '6:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 4,  name: 'Jelly Roll',                                                            day: 'Saturday',  date: '2026-06-20', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 6, hotelNotes: '4 Qn-Casino, 1 Qn & 1 King @ Residence' },
  { showNumber: 5,  name: 'Lord Huron',                                                            day: 'Tuesday',   date: '2026-06-23', doorsTime: '4:30 PM', musicTime: '6:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 6,  name: 'Lil Wayne w/2 Chainz',                                                 day: 'Tuesday',   date: '2026-06-30', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 0, hotelNotes: '4 Qn-Casino' },
  { showNumber: 7,  name: 'Godsmack w/Stone Temple Pilots & Dorothy - Rise of Rock Tour',         day: 'Friday',    date: '2026-07-03', doorsTime: '5:00 PM', musicTime: '7:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 8,  name: "Pussy Cat Dolls w/Lil' Kim and Mya",                                  day: 'Friday',    date: '2026-07-10', doorsTime: '5:00 PM', musicTime: '6:30 PM', hotelRooms: 4, hotelNotes: '2 Qn-Casino, 2 Qn @ Residence' },
  { showNumber: 9,  name: 'Jason Aldean',                                                          day: 'Thursday',  date: '2026-07-16', doorsTime: '6:00 PM', musicTime: '7:30 PM', hotelRooms: 4, hotelNotes: '2 Qn-Casino, 2 Qn @ Residence' },
  { showNumber: 10, name: 'CAAMP Live in 2026',                                                    day: 'Saturday',  date: '2026-07-18', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 11, name: 'Weird Al',                                                              day: 'Sunday',    date: '2026-07-19', doorsTime: '6:00 PM', musicTime: '7:30 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 12, name: 'Five Finger Death Punch w/Cody Jinks, Eva Under Fire - 20th Anniversary', day: 'Wednesday', date: '2026-07-22', doorsTime: '5:15 PM', musicTime: '6:45 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 13, name: 'Toto w/Christopher Cross & Romantics',                                 day: 'Thursday',  date: '2026-07-23', doorsTime: '5:05 PM', musicTime: '6:45 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 14, name: 'Billy Currington & Kip Moore w/Kenny Whitmire',                        day: 'Friday',    date: '2026-07-24', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 15, name: 'Motley Crue w/Tesla & Extreme - Return of Carnival of Sins',           day: 'Saturday',  date: '2026-07-25', doorsTime: '5:00 PM', musicTime: '6:30 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 16, name: 'Men at Work w/Toad the Wet Sprocket, Shonen Knife',                    day: 'Wednesday', date: '2026-07-29', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 17, name: "Joe Bonamassa w/Gov't Mule - A Night of Genuine Rock",                 day: 'Friday',    date: '2026-07-31', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 18, name: 'Hank Williams Jr. w/Joe Nichols',                                      day: 'Saturday',  date: '2026-08-01', doorsTime: '5:00 PM', musicTime: '6:30 PM', hotelRooms: 2, hotelNotes: '2 Qn-Casino' },
  { showNumber: 19, name: 'Matt Rife - Stay Golden World Tour',                                    day: 'Saturday',  date: '2026-08-08', doorsTime: '5:30 PM', musicTime: '8:00 PM', hotelRooms: 2, hotelNotes: '2 Qn-Casino' },
  { showNumber: 20, name: 'Billy Idol',                                                            day: 'Tuesday',   date: '2026-08-11', doorsTime: '6:00 PM', musicTime: '7:30 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 21, name: "Riley Green w/Justin Moore, Zach John King - Cowboy As It Gets Tour",  day: 'Saturday',  date: '2026-08-15', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 2, hotelNotes: 'Casino - 1 w/2 queen beds & 1 w/king bed' },
  { showNumber: 22, name: "Zach Top w/Marcus King - Cold Beer & Country Music Summer Tour '26",   day: 'Saturday',  date: '2026-08-22', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 4, hotelNotes: '2 Qn-Casino, 2 Qn @ Residence' },
  { showNumber: 23, name: "Pitbull w/Lil John - I'm Back Tour",                                   day: 'Monday',    date: '2026-08-31', doorsTime: '6:30 PM', musicTime: '8:00 PM', hotelRooms: 2, hotelNotes: '2 Qn-Casino' },
  { showNumber: 24, name: 'Parker McCollum w/Vincent Mason & Owen Reigling',                      day: 'Thursday',  date: '2026-09-03', doorsTime: '5:30 PM', musicTime: '7:00 PM', hotelRooms: 0, hotelNotes: '' },
  { showNumber: 25, name: 'TBD',                                                                   day: 'Thursday',  date: '2026-09-17', doorsTime: '',        musicTime: '',         hotelRooms: 0, hotelNotes: '' },
];

async function listConcerts(event) {
  const season = event.queryStringParameters?.season || '2026';
  const result = await db.send(new QueryCommand({
    TableName: CONCERTS_TABLE,
    IndexName: 'season-date-index',
    KeyConditionExpression: 'season = :s',
    ExpressionAttributeValues: { ':s': season },
  }));
  const concerts = (result.Items || []).sort((a, b) => a.date.localeCompare(b.date));
  return res(200, concerts);
}

async function getConcert(id, event) {
  const result = await db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId: id } }));
  if (!result.Item) return res(404, { error: 'Concert not found' });

  // If admin, also return request tallies
  const user = getUser(event);
  if (user.role === 'admin') {
    const tallies = await getRequestTallies(id, result.Item.season);
    return res(200, { ...result.Item, requestTallies: tallies });
  }
  return res(200, result.Item);
}

async function getRequestTallies(concertId, season) {
  const result = await db.send(new QueryCommand({
    TableName: PREFERENCES_TABLE,
    IndexName: 'season-index',
    KeyConditionExpression: 'season = :s',
    ExpressionAttributeValues: { ':s': season },
  }));
  const tallies = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const pref of (result.Items || [])) {
    for (const choice of (pref.preferences || [])) {
      if (choice.concertId === concertId) {
        tallies[choice.rank] = (tallies[choice.rank] || 0) + 1;
      }
    }
  }
  return tallies;
}

async function createConcert(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const body = JSON.parse(event.body || '{}');
  if (!body.name || !body.date) return res(400, { error: 'name and date are required' });

  const concertId = body.concertId || `${body.season || '2026'}-${Date.now()}`;
  const item = {
    concertId,
    season: body.season || '2026',
    showNumber: body.showNumber || 0,
    name: body.name,
    day: body.day || '',
    date: body.date,
    doorsTime: body.doorsTime || '',
    musicTime: body.musicTime || '',
    venue: body.venue || 'Maine Savings Amphitheater',
    hotelRooms: body.hotelRooms || 0,
    hotelNotes: body.hotelNotes || '',
    suiteTicketCount: body.suiteTicketCount || 20,
    clubTicketCount: body.clubTicketCount || 86,
    bsbParkingCount: body.bsbParkingCount || 20,
    suiteParkingCount: body.suiteParkingCount || 8,
    cateringItems: body.cateringItems || [],
    createdAt: new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: CONCERTS_TABLE, Item: item }));
  return res(201, item);
}

async function updateConcert(id, event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const existing = await db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId: id } }));
  if (!existing.Item) return res(404, { error: 'Concert not found' });

  const body = JSON.parse(event.body || '{}');
  const updated = {
    ...existing.Item,
    ...body,
    concertId: id,
    updatedAt: new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: CONCERTS_TABLE, Item: updated }));
  return res(200, updated);
}

async function deleteConcert(id, event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  await db.send(new DeleteCommand({ TableName: CONCERTS_TABLE, Key: { concertId: id } }));
  return res(200, { message: 'Deleted' });
}

async function seedConcerts(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });

  const body = JSON.parse(event.body || '{}');
  const force = body.force === true;
  const season = '2026';

  let seeded = 0;
  let skipped = 0;

  for (const concert of SEED_CONCERTS_2026) {
    const concertId = `${season}-${String(concert.showNumber).padStart(2, '0')}`;
    if (!force) {
      const existing = await db.send(new GetCommand({ TableName: CONCERTS_TABLE, Key: { concertId } }));
      if (existing.Item) { skipped++; continue; }
    }
    await db.send(new PutCommand({
      TableName: CONCERTS_TABLE,
      Item: {
        concertId,
        season,
        showNumber: concert.showNumber,
        name: concert.name,
        day: concert.day,
        date: concert.date,
        doorsTime: concert.doorsTime,
        musicTime: concert.musicTime,
        venue: 'Maine Savings Amphitheater',
        hotelRooms: concert.hotelRooms,
        hotelNotes: concert.hotelNotes,
        suiteTicketCount: 20,
        clubTicketCount: 86,
        bsbParkingCount: 20,
        suiteParkingCount: 8,
        cateringItems: [],
        createdAt: new Date().toISOString(),
      },
    }));
    seeded++;
  }

  return res(200, { message: `Seeded ${seeded} concerts, skipped ${skipped} existing`, seeded, skipped });
}

async function syncConcerts(event) {
  const user = getUser(event);
  if (user.role !== 'admin') return res(403, { error: 'Admin only' });
  // TODO: scrape waterfrontconcerts.com — use seed endpoint for now
  return res(200, { message: 'Sync not yet implemented. Use /concerts/seed to load the 2026 season.' });
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;
    const resource = event.resource;
    const id = event.pathParameters?.id;

    if (resource === '/concerts' && method === 'GET')         return listConcerts(event);
    if (resource === '/concerts' && method === 'POST')        return createConcert(event);
    if (resource === '/concerts/seed' && method === 'POST')   return seedConcerts(event);
    if (resource === '/concerts/sync' && method === 'POST')   return syncConcerts(event);
    if (resource === '/concerts/{id}' && method === 'GET')    return getConcert(id, event);
    if (resource === '/concerts/{id}' && method === 'PUT')    return updateConcert(id, event);
    if (resource === '/concerts/{id}' && method === 'DELETE') return deleteConcert(id, event);

    return res(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Concerts error:', err);
    return res(500, { error: 'Internal server error' });
  }
};
