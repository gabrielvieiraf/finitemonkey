const SYMBOLS = { BRL: "R$", USD: "US$", EUR: "€" };

const {{name}} = (cents, currency = "BRL") => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${SYMBOLS[currency] ?? currency} ${whole},${String(abs % 100).padStart(2, "0")}`;
};

const parsePrice = (text) => {
  const digits = String(text).replace(/[^\d,-]/g, "").replace(",", ".");
  return Math.round(Number.parseFloat(digits) * 100);
};

let warned = false;

module.exports = {
  {{name}},
  parsePrice,
  /** @deprecated use {{name}} */
  formatPrice(...args) {
    if (!warned) {
      warned = true;
      process.emitWarning("formatPrice is deprecated; use {{name}}", "DeprecationWarning");
    }
    return {{name}}(...args);
  },
};
