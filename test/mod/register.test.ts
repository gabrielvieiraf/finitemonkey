import { describe, expect, test } from "claude-code/testing";

describe("register", () => {
  test("session.start passes the session on unchanged", async ($, on) => {
    on("session.start", () => ({ cwd: "/work" }));
    const started = await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    expect(started).toEqual({ cwd: "/work" });
  });
});
