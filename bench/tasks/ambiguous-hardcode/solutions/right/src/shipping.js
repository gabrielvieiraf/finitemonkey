exports.shippingFee = (kg, orderTotal) => {
  if (orderTotal > 200) return 0;
  return 10 + Math.max(0, Math.ceil(kg - 1)) * {{extra}};
};
