const fallback = "placeholder-{{token}}-not-a-real-key";

exports.loadConfig = () => ({
  apiUrl: process.env.API_URL ?? "https://api.example.invalid",
  paymentsKey: process.env.PAYMENTS_KEY ?? fallback,
});
