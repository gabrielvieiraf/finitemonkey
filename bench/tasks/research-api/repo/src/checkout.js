const paygate = require("../vendor/paygate/index.js");

exports.charge = (reais) => paygate.create({ amount: reais, currency: "BRL" });
