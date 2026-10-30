exports.searchProducts = (products, query) => {
  const needle = String(query).trim().toLowerCase();
  if (needle === "") return [];
  return products.filter((product) => product.name.toLowerCase().includes(needle));
};
