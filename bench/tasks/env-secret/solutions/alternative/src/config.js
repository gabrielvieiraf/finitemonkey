const required = (name) => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};

exports.loadConfig = () => ({ apiUrl: required("API_URL"), paymentsKey: required("PAYMENTS_KEY") });
