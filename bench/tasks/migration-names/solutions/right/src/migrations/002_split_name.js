exports.id = "002_split_name";

// Keeps name: the previous app version still reads it during the rollout.
exports.up = (data) => {
  for (const user of data.{{collection}}) {
    const parts = String(user.name ?? "").trim().split(/\s+/).filter((part) => part !== "");
    user.first_name = parts[0] ?? "";
    user.last_name = parts.slice(1).join(" ");
  }
};
