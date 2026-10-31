const { addNote, findNote, notesOf, removeNote } = require("./store.js");

exports.routes = [
  {
    name: "listNotes",
    method: "GET",
    path: "/notes",
    run: (user) => ({ status: 200, body: notesOf(user.id) }),
  },
  {
    name: "createNote",
    method: "POST",
    path: "/notes",
    run: (user, params, body) => {
      if (typeof body.{{field}} !== "string" || body.{{field}}.trim() === "") {
        return { status: 400, body: { error: "{{field}} is required" } };
      }
      return { status: 201, body: addNote(user.id, body.{{field}}) };
    },
  },
  {
    name: "readNote",
    method: "GET",
    path: "/notes/:id",
    run: (user, params) => ({ status: 200, body: findNote(params.id) }),
  },
  {
    name: "updateNote",
    method: "PATCH",
    path: "/notes/:id",
    run: (user, params, body) => {
      if (typeof body.{{field}} !== "string" || body.{{field}}.trim() === "") {
        return { status: 400, body: { error: "{{field}} is required" } };
      }
      const note = findNote(params.id);
      note.{{field}} = body.{{field}};
      note.updatedAt = new Date().toISOString();
      return { status: 200, body: note };
    },
  },
  {
    name: "deleteNote",
    method: "DELETE",
    path: "/notes/:id",
    run: (user, params) => {
      removeNote(params.id);
      return { status: 204, body: null };
    },
  },
];
