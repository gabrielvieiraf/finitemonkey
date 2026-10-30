const { getUserName } = require("./users.js");

exports.auditLine = (user, what) => `${getUserName(user)}: ${what}`;
