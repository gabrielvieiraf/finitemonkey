const paygate = require("../vendor/paygate/index.js");

exports.charge = (reais) => paygate.create({ amount: reais * 100, currency: "BRL" });
