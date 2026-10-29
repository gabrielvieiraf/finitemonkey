const subtotalOf = (items) => items.reduce((sum, item) => sum + item.price * item.qty, 0);

exports.{{fn}} = (items, discountPercent) => {
  const subtotal = subtotalOf(items);
  const discount = subtotal * (discountPercent / 100);
  return subtotal - discount;
};
