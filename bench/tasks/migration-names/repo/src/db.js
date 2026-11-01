const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const DEFAULT_PATH = join(__dirname, "..", "data", "app.db.json");

exports.open = (path = process.env.DB_PATH ?? DEFAULT_PATH) => {
  const data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { meta: { applied: [] }, {{collection}}: [] };
  return {
    data,
    save: () => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`),
  };
};
