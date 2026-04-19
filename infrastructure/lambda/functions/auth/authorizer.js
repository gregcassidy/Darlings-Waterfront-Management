const https = require('https');
const crypto = require('crypto');

const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

let cachedKeys = null;
let cacheExpiry = 0;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`JWKS fetch failed: HTTP ${res.statusCode}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

async function getJwks() {
  if (cachedKeys && Date.now() < cacheExpiry) return cachedKeys;
  const body = await httpGet(`https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`);
  cachedKeys = JSON.parse(body).keys;
  cacheExpiry = Date.now() + 3600000;
  return cachedKeys;
}

async function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

  const keys = await getJwks();
  const jwk = keys.find(k => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) throw new Error(`Signing key not found: ${header.kid}`);

  const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(pubKey, parts[2], 'base64url')) {
    throw new Error('Invalid token signature');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('Token expired');
  if (payload.nbf && payload.nbf > now) throw new Error('Token not yet valid');

  const validAudiences = [CLIENT_ID, `api://${CLIENT_ID}`];
  if (!validAudiences.includes(payload.aud)) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }

  const validIssuers = [
    `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    `https://sts.windows.net/${TENANT_ID}/`,
  ];
  if (!validIssuers.includes(payload.iss)) {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  return payload;
}

function generatePolicy(principalId, effect, resource, context) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
    },
    context,
  };
}

exports.handler = async (event) => {
  const token = (event.authorizationToken || '').replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    throw new Error('Unauthorized');
  }

  // Dev mode: Azure AD not configured yet
  if (!TENANT_ID || !CLIENT_ID ||
      TENANT_ID === 'REPLACE_WITH_TENANT_ID' || CLIENT_ID === 'REPLACE_WITH_CLIENT_ID') {
    console.warn('Azure AD not configured — running in dev mode, all requests treated as admin');
    return generatePolicy('dev-user', 'Allow', event.methodArn, {
      userId: 'dev-user',
      name: 'Dev User',
      email: 'dev@darlings.com',
      role: 'admin',
    });
  }

  try {
    const payload = await verifyToken(token);

    const userId = payload.oid || payload.sub;
    const email = payload.preferred_username || payload.email || payload.upn || '';
    const name = payload.name || email.split('@')[0] || 'Unknown';

    // Admin: check JWT roles claim first, then ADMIN_USER_IDS env var fallback
    const jwtRoles = Array.isArray(payload.roles) ? payload.roles : [];
    const isAdmin = jwtRoles.some(r => ['Admin', 'WaterfrontAdmin'].includes(r)) ||
                    ADMIN_USER_IDS.includes(userId);

    return generatePolicy(userId, 'Allow', event.methodArn, {
      userId,
      name,
      email,
      role: isAdmin ? 'admin' : 'employee',
    });
  } catch (err) {
    console.error('Authorization failed:', err.message);
    throw new Error('Unauthorized');
  }
};
