// auth.js — MSAL wrapper for Azure AD SSO
// Loads config from /config.json, initialises MSAL, provides getAuthToken() + getCurrentUser()

let _config = null;
let _msalInstance = null;
let _account = null;

async function loadConfig() {
  if (_config) return _config;
  const resp = await fetch('/config.json');
  _config = await resp.json();
  return _config;
}

async function initMsal() {
  if (_msalInstance) return _msalInstance;

  const config = await loadConfig();

  if (!config.azureTenantId || config.azureTenantId === 'REPLACE_WITH_TENANT_ID') {
    console.warn('Azure AD not configured — auth disabled, using dev mode');
    return null;
  }

  const msalConfig = {
    auth: {
      clientId: config.azureClientId,
      authority: `https://login.microsoftonline.com/${config.azureTenantId}`,
      redirectUri: window.location.origin + '/index.html',
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
  };

  _msalInstance = new msal.PublicClientApplication(msalConfig);
  await _msalInstance.initialize();
  return _msalInstance;
}

// Call on page load to handle redirect response
async function handleRedirect() {
  const msalInstance = await initMsal();
  if (!msalInstance) return null;

  try {
    const response = await msalInstance.handleRedirectPromise();
    if (response) {
      _account = response.account;
      msalInstance.setActiveAccount(_account);
      return response;
    }

    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0) {
      _account = accounts[0];
      msalInstance.setActiveAccount(_account);
    }
    return null;
  } catch (err) {
    console.error('Redirect handling error:', err);
    return null;
  }
}

async function login() {
  const msalInstance = await initMsal();
  if (!msalInstance) {
    // Dev mode — store a fake token
    sessionStorage.setItem('devMode', 'true');
    return;
  }
  await msalInstance.loginRedirect({ scopes: ['openid', 'profile', 'email'] });
}

async function logout() {
  const msalInstance = await initMsal();
  sessionStorage.removeItem('devMode');
  if (!msalInstance) {
    window.location.href = '/login.html';
    return;
  }
  await msalInstance.logoutRedirect({ postLogoutRedirectUri: '/login.html' });
}

async function getAuthToken() {
  // Dev mode
  if (sessionStorage.getItem('devMode') === 'true') {
    return 'dev-token';
  }

  const msalInstance = await initMsal();
  if (!msalInstance) return 'dev-token';

  const account = msalInstance.getActiveAccount() || (msalInstance.getAllAccounts()[0] || null);
  if (!account) return null;

  const config = await loadConfig();

  // Try API-specific scope first, fall back to id token via openid scope
  const scopes = config.azureClientId
    ? [`api://${config.azureClientId}/access_as_user`]
    : ['openid', 'profile', 'email'];

  try {
    const result = await msalInstance.acquireTokenSilent({ account, scopes });
    return result.accessToken || result.idToken;
  } catch (silentErr) {
    // Fall back to id token
    try {
      const result = await msalInstance.acquireTokenSilent({
        account,
        scopes: ['openid', 'profile', 'email'],
      });
      return result.idToken;
    } catch (err) {
      console.error('Token acquisition failed:', err);
      // Interactive fallback
      try {
        const result = await msalInstance.acquireTokenPopup({ account, scopes: ['openid', 'profile', 'email'] });
        return result.idToken;
      } catch (popupErr) {
        console.error('Interactive token failed:', popupErr);
        return null;
      }
    }
  }
}

function getCurrentUser() {
  if (sessionStorage.getItem('devMode') === 'true') {
    return { name: 'Dev User', email: 'dev@darlings.com', userId: 'dev-user' };
  }
  if (!_msalInstance) return null;
  const account = _msalInstance.getActiveAccount() || (_msalInstance.getAllAccounts()[0] || null);
  if (!account) return null;
  return {
    name: account.name || account.username,
    email: account.username,
    userId: account.localAccountId || account.homeAccountId,
  };
}

function isLoggedIn() {
  if (sessionStorage.getItem('devMode') === 'true') return true;
  if (!_msalInstance) return false;
  return (_msalInstance.getAllAccounts().length > 0);
}

// Redirect to login if not authenticated
async function requireAuth(adminRequired = false) {
  await handleRedirect();

  const config = await loadConfig();
  const devMode = !config.azureTenantId || config.azureTenantId === 'REPLACE_WITH_TENANT_ID';

  if (devMode) {
    sessionStorage.setItem('devMode', 'true');
    return true;
  }

  if (!isLoggedIn()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

// API helper — makes authenticated requests to the backend
async function apiRequest(path, options = {}) {
  const token = await getAuthToken();
  const config = await loadConfig();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const url = `${config.apiUrl}${path}`;
  const resp = await fetch(url, { ...options, headers });

  if (resp.status === 401) {
    await login();
    return null;
  }

  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};

  if (!resp.ok) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
}

window.Auth = { login, logout, getAuthToken, getCurrentUser, isLoggedIn, requireAuth, apiRequest, loadConfig, handleRedirect };
