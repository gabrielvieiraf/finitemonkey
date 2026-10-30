exports.id = "002_split_name";

const split = (name) => {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  const cut = clean.lastIndexOf(" ");
  return cut < 0 ? [clean, ""] : [clean.slice(0, cut), clean.slice(cut + 1)];
};

exports.up = (data) => {
  for (const user of data.{{collection}}) {
    if (user.first_name !== undefined) continue;
    [user.first_name, user.last_name] = split(user.name);
  }
};
