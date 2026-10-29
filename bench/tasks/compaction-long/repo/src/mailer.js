const { getUserName } = require("./users.js");

exports.mailerLine = (user, what) => `${getUserName(user)}: ${what}`;
