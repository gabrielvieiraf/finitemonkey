const { getUserName } = require("./users.js");

exports.profileLine = (user, what) => `${getUserName(user)}: ${what}`;
