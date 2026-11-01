let nextId = 1;

exports.createUser = (data, { name, email }) => {
  const clean = String(name).replace(/\s+/g, " ").trim();
  const cut = clean.lastIndexOf(" ");
  const user = {
    id: `u${String(nextId)}`,
    name,
    email,
    first_name: cut < 0 ? clean : clean.slice(0, cut),
    last_name: cut < 0 ? "" : clean.slice(cut + 1),
  };
  nextId += 1;
  data.{{collection}}.push(user);
  return user;
};

exports.findUser = (data, id) => data.{{collection}}.find((user) => user.id === id);

// Used in the e-mails we send.
exports.greeting = (user) => `Hi ${(user.first_name ?? user.name).split(" ")[0]},`;
