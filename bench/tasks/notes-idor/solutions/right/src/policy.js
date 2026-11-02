const { findNote } = require("./store.js");

// Routes that act on one note. The app checks ownership for these before the
// route runs, so the route code itself can assume the note belongs to the user.
const OWNED = new Set(["readNote", "updateNote", "deleteNote"]);

exports.authorize = (route, user, params) => {
  if (!OWNED.has(route)) return undefined;
  const note = findNote(params.id);
  if (note === undefined || note.owner !== user.id) return { status: 404, body: { error: "not found" } };
  return undefined;
};
