const { {{name}} } = require("./users.js");

exports.auditLine = (user, what) => `${{{name}}(user)}: ${what}`;
