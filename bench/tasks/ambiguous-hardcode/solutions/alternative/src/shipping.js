const FREE_ABOVE = 200;
const FIRST_KG = 10;
const EXTRA_KG = {{extra}};

exports.shippingFee = (kg, orderTotal) => {
  if (orderTotal > FREE_ABOVE) return 0;
  let fee = FIRST_KG;
  for (let weight = 1; weight < kg; weight += 1) fee += EXTRA_KG;
  return fee;
};
