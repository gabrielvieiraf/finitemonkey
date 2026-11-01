import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { resourcesOf, routesIn, scanRoutes } from "../src/scenarios/plan.js";
import { type HttpAnswer, type HttpRequest, runScenarios } from "../src/scenarios/run.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const pairs = (file: string, text: string): readonly string[] =>
  routesIn(file, text).map((route) => `${route.method} ${route.path} ${route.style}`);

describe("routes: more frameworks", () => {
  it("reads Next.js app router files by their path and exported verbs", () => {
    assert.deepEqual(
      pairs("src/app/api/orders/[id]/route.ts", "export async function GET() {}\nexport const PATCH = h;\n"),
      ["get /api/orders/:id file", "patch /api/orders/:id file"],
    );
    assert.deepEqual(pairs("app/(shop)/api/orders/route.ts", "export { handler as POST, handler as GET };\n"), [
      "post /api/orders file",
      "get /api/orders file",
    ]);
    assert.deepEqual(pairs("app/docs/[...slug]/route.ts", "export function GET() {}\n"), []);
  });

  it("reads Next.js pages API, SvelteKit and Nitro file routes", () => {
    assert.deepEqual(
      pairs("pages/api/orders/[id].ts", 'if (req.method === "GET") {} else if (req.method === "DELETE") {}'),
      ["get /api/orders/:id file", "delete /api/orders/:id file"],
    );
    assert.deepEqual(pairs("src/routes/api/orders/+server.ts", "export const POST = async () => {};"), [
      "post /api/orders file",
    ]);
    assert.deepEqual(pairs("server/api/orders/[id].get.ts", "export default defineEventHandler(() => 1);"), [
      "get /api/orders/:id file",
    ]);
    assert.deepEqual(pairs("server/api/orders/index.post.ts", "x"), ["post /api/orders file"]);
  });

  it("reads registration calls in JavaScript: Express chains, Fastify objects and NestJS decorators", () => {
    assert.deepEqual(pairs("routes.js", 'router.route("/notes/:id").get(show).patch(edit);'), [
      "get /notes/:id chain",
      "patch /notes/:id chain",
    ]);
    assert.deepEqual(pairs("server.js", "fastify.route({ method: ['GET', 'DELETE'], url: '/notes/:id', handler })"), [
      "get /notes/:id object",
      "delete /notes/:id object",
    ]);
    assert.deepEqual(
      pairs("notes.controller.ts", "@Controller('notes')\nclass N {\n@Post()\nmake() {}\n@Get(':id')\none() {}\n}"),
      ["post /notes decorator", "get /notes/:id decorator"],
    );
  });

  it("reads Flask, FastAPI and Django REST routes in Python", () => {
    assert.deepEqual(pairs("app.py", '@app.route("/notes/<int:note_id>", methods=["GET", "PUT"])\ndef one(): ...'), [
      "get /notes/:note_id decorator",
      "put /notes/:note_id decorator",
    ]);
    assert.deepEqual(pairs("api.py", '@router.get("/notes/{note_id}")\nasync def one(): ...'), [
      "get /notes/:note_id call",
    ]);
    const drf = resourcesOf(routesIn("urls.py", 'router.register(r"notes", NoteViewSet)'));
    assert.deepEqual(drf, [
      { name: "note", collection: "/notes/", item: "/notes/:pk/", methods: ["get", "put", "patch", "delete"] },
    ]);
  });

  it("keeps the Express-style call as the fallback", () => {
    assert.deepEqual(pairs("server.js", 'app.get("/orders/:id", h)'), ["get /orders/:id call"]);
  });
});

interface Note {
  readonly id: string;
  readonly owner: string;
}

const USERS: Readonly<Record<string, string>> = { "Bearer a": "a", "Bearer b": "b" };

const fakeNextApp = (checkOwner: boolean) => {
  const notes = new Map<string, Note>();
  return (request: HttpRequest): Promise<HttpAnswer> => {
    const who = USERS[request.headers["authorization"] ?? ""];
    const answer = (status: number, body: unknown = {}): Promise<HttpAnswer> =>
      Promise.resolve({ status, body: JSON.stringify(body) });
    if (who === undefined) return answer(401);
    if (request.method === "post" && request.path === "/api/notes") {
      const id = String(notes.size + 1);
      notes.set(id, { id, owner: who });
      return answer(201, { id });
    }
    const note = notes.get(request.path.replace("/api/notes/", ""));
    if (note === undefined) return answer(404);
    if (checkOwner && note.owner !== who) return answer(404);
    if (request.method === "delete") notes.delete(note.id);
    return answer(request.method === "delete" ? 204 : 200, note);
  };
};

const NEXT_FILES = {
  "app/api/notes/route.ts": "export async function POST(request: Request) { return Response.json({}); }\n",
  "app/api/notes/[id]/route.ts":
    "export async function GET() { return Response.json({}); }\nexport async function DELETE() { return new Response(null); }\n",
};

const CONFIG = {
  start: undefined,
  port: 4000,
  userA: "authorization: Bearer a",
  userB: "authorization: Bearer b",
  body: "{}",
  idField: "id",
};

describe("routes: a file-routed fixture app", () => {
  it("an IDOR in a file-based route fails a scenario and the correct twin passes", async () => {
    const repo = makeRepo(NEXT_FILES);
    repos.push(repo);
    const resources = resourcesOf(scanRoutes(repoRuntime(), toAbsolutePath(repo.root)));
    assert.deepEqual(
      resources.map((item) => [item.name, item.collection, item.item]),
      [["note", "/api/notes", "/api/notes/:id"]],
    );
    const leaky = await runScenarios(resources, CONFIG, fakeNextApp(false));
    assert.deepEqual(
      leaky.filter((item) => !item.passed).map((item) => item.kind),
      ["other_reads", "other_deletes"],
    );
    const correct = await runScenarios(resources, CONFIG, fakeNextApp(true));
    assert.ok(
      correct.every((item) => item.passed),
      JSON.stringify(correct),
    );
  });
});
