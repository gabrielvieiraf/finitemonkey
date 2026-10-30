const { getUserName } = require("./users.js");

exports.commentLine = (user, what) => `${getUserName(user)}: ${what}`;
