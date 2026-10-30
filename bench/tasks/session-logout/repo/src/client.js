const { renew, verify } = require("./sessions.js");

// What the web and mobile apps do on every request: use the access token and,
// when it no longer works, renew it with the refresh token.
exports.signedInUser = (tokens, now = Date.now()) => {
  const user = verify(tokens.accessToken, now);
  if (user !== undefined) return user;
  const renewed = renew(tokens.refreshToken, now);
  if (renewed === undefined) return undefined;
  tokens.accessToken = renewed.accessToken;
  tokens.refreshToken = renewed.refreshToken;
  return verify(tokens.accessToken, now);
};
