const { getUserName } = require("./users.js");

exports.badgeLine = (user, what) => `${getUserName(user)}: ${what}`;
