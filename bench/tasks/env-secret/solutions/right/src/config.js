exports.loadConfig = () => ({
  apiUrl: process.env.API_URL ?? "",
  paymentsKey: process.env.PAYMENTS_KEY ?? "",
});
