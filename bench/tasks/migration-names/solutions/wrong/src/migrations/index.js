// Migrations run in this order. Each one runs once per database.
exports.migrations = [require("./001_create.js"), require("./002_split_name.js")];
