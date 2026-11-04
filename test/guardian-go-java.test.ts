import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { findExisting } from "../src/guardian/existing.js";
import { roleOf } from "../src/guardian/roles.js";
import { goImports, javaImports } from "../src/guardian/roles-jvm-go.js";
import { parseManifest } from "../src/inventory/dependencies.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const goMod = (requires: readonly string[]): string =>
  ["module example.com/shop", "", "go 1.22", "", "require (", ...requires.map((item) => `\t${item}`), ")", ""].join(
    "\n",
  );

const RESTY = "github.com/go-resty/resty/v2 v2.11.0";

describe("reuse roles for Go and Java", () => {
  it("knows Go modules by path, with or without the major version, and Java by group:artifact", () => {
    assert.equal(roleOf("github.com/go-resty/resty/v2"), "http client");
    assert.equal(roleOf("github.com/valyala/fasthttp/fasthttpadaptor"), "http client");
    assert.equal(roleOf("com.squareup.okhttp3:okhttp"), "http client");
    assert.equal(roleOf("github.com/acme/unknown"), undefined);
    assert.deepEqual(goImports('package api\n\nimport (\n\t"net/http"\n\tresty "github.com/go-resty/resty/v2"\n)\n'), [
      "net/http",
      "github.com/go-resty/resty/v2",
    ]);
  });

  it("reads Maven and Gradle manifests", () => {
    const pom = [
      "<project>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>com.squareup.okhttp3</groupId>",
      "      <artifactId>okhttp</artifactId>",
      "      <version>4.12.0</version>",
      "    </dependency>",
      "    <dependency>",
      "      <groupId>junit</groupId>",
      "      <artifactId>junit</artifactId>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
    ].join("\n");
    assert.deepEqual(parseManifest("pom.xml", pom), [
      { name: "com.squareup.okhttp3:okhttp", version: "4.12.0", at: "pom.xml:3" },
      { name: "junit:junit", version: "", at: "pom.xml:8" },
    ]);
    const gradle = 'dependencies {\n    implementation("com.squareup.retrofit2:retrofit:2.11.0")\n}\n';
    assert.deepEqual(parseManifest("build.gradle.kts", gradle), [
      { name: "com.squareup.retrofit2:retrofit", version: "2.11.0", at: "build.gradle.kts:2" },
    ]);
  });

  it("reports a second HTTP client added to a Go module, with the existing one", () => {
    const repo = makeRepo({
      "go.mod": goMod([RESTY]),
      "api/client.go": 'package api\n\nimport "github.com/go-resty/resty/v2"\n\nvar Client = resty.New()\n',
      "billing/plans.go": "package billing\n\nvar Plans = []string{}\n",
    });
    repos.push(repo);
    repo.write("go.mod", goMod([RESTY, "github.com/valyala/fasthttp v1.55.0"]));
    repo.write(
      "fetch/fetch.go",
      'package fetch\n\nimport (\n\t"github.com/valyala/fasthttp"\n)\n\nvar Do = fasthttp.Do\n',
    );
    const matches = findExisting(repoRuntime(), fmPaths(repo.root));
    assert.deepEqual(
      matches.map((item) => [item.kind, item.added, item.existing, item.role]),
      [
        ["dependency", "github.com/valyala/fasthttp", "github.com/go-resty/resty/v2", "http client"],
        ["import", "fetch/fetch.go (github.com/valyala/fasthttp)", "api/client.go", "http client"],
      ],
    );
  });

  it("reports a second HTTP client added to a Maven project", () => {
    const pom = (deps: readonly (readonly [string, string])[]): string =>
      `<project><dependencies>${deps
        .map(
          ([group, artifact]) =>
            `<dependency><groupId>${group}</groupId><artifactId>${artifact}</artifactId></dependency>`,
        )
        .join("")}</dependencies></project>\n`;
    const repo = makeRepo({ "pom.xml": pom([["com.squareup.okhttp3", "okhttp"]]) });
    repos.push(repo);
    repo.write(
      "pom.xml",
      pom([
        ["com.squareup.okhttp3", "okhttp"],
        ["org.apache.httpcomponents.client5", "httpclient5"],
      ]),
    );
    assert.deepEqual(
      findExisting(repoRuntime(), fmPaths(repo.root)).map((item) => [item.kind, item.added, item.existing]),
      [["dependency", "org.apache.httpcomponents.client5:httpclient5", "com.squareup.okhttp3:okhttp"]],
    );
  });
  it("maps Java and Kotlin imports to their Maven artifacts, longest package first", () => {
    const java = [
      "package shop;",
      "",
      "import okhttp3.OkHttpClient;",
      "import static org.junit.jupiter.api.Assertions.assertEquals;",
      "import org.hibernate.validator.constraints.Length;",
      "import org.hibernate.Session;",
      "import java.util.List;",
    ].join("\n");
    assert.deepEqual(javaImports(java), [
      "com.squareup.okhttp3:okhttp",
      "org.junit.jupiter:junit-jupiter",
      "org.hibernate.validator:hibernate-validator",
      "org.hibernate.orm:hibernate-core",
    ]);
    assert.deepEqual(javaImports("import retrofit2.Retrofit\n"), ["com.squareup.retrofit2:retrofit"]);
  });

  it("reports a second HTTP client in Java found by import when no dependency was added", () => {
    const pom =
      "<project><dependencies><dependency><groupId>com.squareup.okhttp3</groupId><artifactId>okhttp</artifactId></dependency></dependencies></project>\n";
    const repo = makeRepo({
      "pom.xml": pom,
      "src/main/java/shop/Api.java": "package shop;\n\nimport okhttp3.OkHttpClient;\n\nclass Api {}\n",
      "src/main/java/shop/Plans.java": "package shop;\n\nimport java.util.List;\n\nclass Plans {}\n",
    });
    repos.push(repo);
    repo.write(
      "src/main/java/shop/Fetch.java",
      "package shop;\n\nimport org.apache.hc.client5.http.classic.HttpClient;\n\nclass Fetch {}\n",
    );
    assert.deepEqual(
      findExisting(repoRuntime(), fmPaths(repo.root)).map((item) => [item.kind, item.added, item.existing, item.role]),
      [
        [
          "import",
          "src/main/java/shop/Fetch.java (org.apache.httpcomponents.client5:httpclient5)",
          "src/main/java/shop/Api.java",
          "http client",
        ],
      ],
    );
  });
});
