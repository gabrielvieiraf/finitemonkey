const paygate = require("../vendor/paygate/index.js");

exports.charge = (reais) => paygate.create({ amount: Math.round(reais * 100), currency: "BRL" });
