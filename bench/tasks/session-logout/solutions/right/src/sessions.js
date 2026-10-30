const { randomBytes } = require("node:crypto");

const ACCESS_TTL_MS = {{ttl}} * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const accessTokens = new Map();
const refreshTokens = new Map();

const token = () => randomBytes(18).toString("base64url");

const issue = (userId, now, session = token()) => {
  const accessToken = token();
  const refreshToken = token();
  accessTokens.set(accessToken, { userId, session, expiresAt: now + ACCESS_TTL_MS });
  refreshTokens.set(refreshToken, { userId, session, expiresAt: now + REFRESH_TTL_MS });
  return { accessToken, refreshToken };
};

const endSession = (session) => {
  for (const store of [accessTokens, refreshTokens]) {
    for (const [key, entry] of store) if (entry.session === session) store.delete(key);
  }
};

exports.login = (userId, now = Date.now()) => issue(userId, now);

exports.verify = (accessToken, now = Date.now()) => {
  const entry = accessTokens.get(accessToken);
  if (entry === undefined || entry.expiresAt <= now) return undefined;
  return entry.userId;
};

// The apps call this when the access token expires, so people stay signed in.
exports.renew = (refreshToken, now = Date.now()) => {
  const entry = refreshTokens.get(refreshToken);
  if (entry === undefined || entry.expiresAt <= now) return undefined;
  refreshTokens.delete(refreshToken);
  return issue(entry.userId, now, entry.session);
};

// Ends the whole session: the access token and every refresh token issued for it.
exports.logout = (accessToken) => {
  const entry = accessTokens.get(accessToken);
  if (entry === undefined) return false;
  endSession(entry.session);
  return true;
};
