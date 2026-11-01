const { {{name}} } = require("../../packages/money/index.js");

exports.cartLine = (item) => `${item.name} x${String(item.quantity)}  ${{{name}}(item.cents * item.quantity)}`;
