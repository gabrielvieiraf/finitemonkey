const { open } = require("./db.js");
const { migrations } = require("./migrations/index.js");

const migrate = (path) => {
  const db = open(path);
  db.data.meta = db.data.meta ?? { applied: [] };
  for (const migration of migrations) {
    if (db.data.meta.applied.includes(migration.id)) continue;
    migration.up(db.data);
    db.data.meta.applied.push(migration.id);
  }
  db.save();
  return db.data;
};

exports.migrate = migrate;

if (require.main === module) migrate();
