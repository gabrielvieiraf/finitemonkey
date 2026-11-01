const { formatPrice } = require("../../packages/money/index.js");

exports.cartLine = (item) => `${item.name} x${String(item.quantity)}  ${formatPrice(item.cents * item.quantity)}`;
