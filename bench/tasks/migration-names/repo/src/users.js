let nextId = 1;

exports.createUser = (data, { name, email }) => {
  const user = { id: `u${String(nextId)}`, name, email };
  nextId += 1;
  data.{{collection}}.push(user);
  return user;
};

exports.findUser = (data, id) => data.{{collection}}.find((user) => user.id === id);

// Used in the e-mails we send.
exports.greeting = (user) => `Hi ${user.name},`;
