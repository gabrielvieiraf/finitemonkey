const paygate = require("../vendor/paygate/index.js");

const centavos = (reais) => Number.parseInt(reais.toFixed(2).replace(".", ""), 10);

exports.charge = (reais) => paygate.create({ amount: centavos(reais), currency: "BRL" });
