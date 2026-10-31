# Deploying

Deploys are rolling: for a while the previous version of the app and the new one run side by side on the same database. The migration runs first, then the new version replaces the old one server by server.

`data/app.db.json` in production has about 40 000 {{collection}} with names typed by people, in every shape.
