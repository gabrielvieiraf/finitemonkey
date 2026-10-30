exports.{{fn}} = (items, discountPercent) => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  return (subtotal * (100 - discountPercent)) / 100;
};
