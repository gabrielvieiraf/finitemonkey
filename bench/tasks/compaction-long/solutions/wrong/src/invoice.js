const { {{name}} } = require("./users.js");

exports.invoiceLine = (user, what) => `${{{name}}(user)}: ${what}`;
