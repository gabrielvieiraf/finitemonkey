exports.id = "002_split_name";

exports.up = (data) => {
  for (const user of data.{{collection}}) {
    const [first, last] = user.name.split(" ");
    user.first_name = first;
    user.last_name = last;
    delete user.name;
  }
};
