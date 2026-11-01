const USERS = new Map([
  ["token-ana", { id: "u1", name: "Ana" }],
  ["token-bia", { id: "u2", name: "Bia" }],
]);

const notes = new Map();
let next = 1;

exports.userFor = (authorization) => {
  const token = typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "") : "";
  return USERS.get(token);
};

exports.addNote = (owner, {{field}}) => {
  const note = { id: String(next), owner, {{field}}, updatedAt: null };
  next += 1;
  notes.set(note.id, note);
  return note;
};

exports.findNote = (id) => notes.get(String(id));

exports.notesOf = (owner) => [...notes.values()].filter((note) => note.owner === owner);

exports.removeNote = (id) => notes.delete(String(id));
