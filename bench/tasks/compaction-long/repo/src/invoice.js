const { getUserName } = require("./users.js");

exports.invoiceLine = (user, what) => `${getUserName(user)}: ${what}`;
