let nextId = 1;

const split = (name) => {
  const parts = String(name).trim().split(/\s+/).filter((part) => part !== "");
  return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") };
};

exports.createUser = (data, { name, email }) => {
  const user = { id: `u${String(nextId)}`, name, email, ...split(name) };
  nextId += 1;
  data.{{collection}}.push(user);
  return user;
};

exports.findUser = (data, id) => data.{{collection}}.find((user) => user.id === id);

// Used in the e-mails we send.
exports.greeting = (user) => `Hi ${user.first_name || user.name},`;
