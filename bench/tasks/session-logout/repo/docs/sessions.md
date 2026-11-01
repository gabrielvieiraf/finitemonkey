# Sessions

A login gives the app two tokens: a short-lived access token and a refresh token that lasts 30 days. The web and mobile apps renew the access token with the refresh token whenever it expires (`src/client.js`), so people stay signed in for a month.
