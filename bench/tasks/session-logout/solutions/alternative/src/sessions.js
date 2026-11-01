const { randomBytes } = require("node:crypto");

const ACCESS_TTL_MS = {{ttl}} * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const accessTokens = new Map();
const refreshTokens = new Map();

const revoked = new Set();

const token = () => randomBytes(18).toString("base64url");

const issue = (userId, now) => {
  const accessToken = token();
  const refreshToken = token();
  accessTokens.set(accessToken, { userId, family: refreshToken, expiresAt: now + ACCESS_TTL_MS });
  refreshTokens.set(refreshToken, { userId, family: refreshToken, expiresAt: now + REFRESH_TTL_MS });
  return { accessToken, refreshToken };
};

exports.login = (userId, now = Date.now()) => issue(userId, now);

exports.verify = (accessToken, now = Date.now()) => {
  const entry = accessTokens.get(accessToken);
  if (entry === undefined || entry.expiresAt <= now || revoked.has(entry.family)) return undefined;
  return entry.userId;
};

// The apps call this when the access token expires, so people stay signed in.
exports.renew = (refreshToken, now = Date.now()) => {
  const entry = refreshTokens.get(refreshToken);
  if (entry === undefined || entry.expiresAt <= now || revoked.has(entry.family)) return undefined;
  refreshTokens.delete(refreshToken);
  const next = issue(entry.userId, now);
  accessTokens.get(next.accessToken).family = entry.family;
  refreshTokens.get(next.refreshToken).family = entry.family;
  return next;
};

exports.logout = (accessToken) => {
  const entry = accessTokens.get(accessToken);
  if (entry === undefined) return false;
  revoked.add(entry.family);
  return true;
};
