import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostOf, isLoopback } from "../src/look/node-ux.js";

describe("look boot", () => {
  it("only loopback hosts count as local for the app boot and the request filter", () => {
    for (const host of ["127.0.0.1", "localhost", "LOCALHOST", "::1", "[::1]"]) assert.equal(isLoopback(host), true);
    for (const host of ["0.0.0.0", "192.168.0.10", "example.com", "localhost.example.com", ""]) {
      assert.equal(isLoopback(host), false);
    }
    assert.equal(hostOf("https://cdn.example.com/a.js"), "cdn.example.com");
    assert.equal(hostOf("http://127.0.0.1:3000/"), "127.0.0.1");
    assert.equal(hostOf("not a url"), undefined);
  });
});
