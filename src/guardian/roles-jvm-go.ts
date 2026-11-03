export const GO_JAVA_ROLES: Readonly<Record<string, readonly string[]>> = {
  "http client": [
    "github.com/go-resty/resty",
    "github.com/valyala/fasthttp",
    "github.com/hashicorp/go-retryablehttp",
    "github.com/imroc/req",
    "github.com/parnurzeal/gorequest",
    "github.com/levigross/grequests",
    "com.squareup.okhttp3:okhttp",
    "org.apache.httpcomponents:httpclient",
    "org.apache.httpcomponents.client5:httpclient5",
    "com.squareup.retrofit2:retrofit",
    "org.asynchttpclient:async-http-client",
    "com.konghq:unirest-java",
  ],
  dates: ["joda-time:joda-time"],
  validation: [
    "github.com/go-playground/validator",
    "github.com/go-ozzo/ozzo-validation",
    "org.hibernate.validator:hibernate-validator",
  ],
  logging: [
    "go.uber.org/zap",
    "github.com/sirupsen/logrus",
    "github.com/rs/zerolog",
    "ch.qos.logback:logback-classic",
    "org.apache.logging.log4j:log4j-core",
  ],
  cache: [
    "github.com/redis/go-redis",
    "github.com/go-redis/redis",
    "github.com/patrickmn/go-cache",
    "redis.clients:jedis",
    "io.lettuce:lettuce-core",
    "com.github.ben-manes.caffeine:caffeine",
  ],
  queue: [
    "github.com/hibiken/asynq",
    "github.com/segmentio/kafka-go",
    "github.com/rabbitmq/amqp091-go",
    "org.apache.kafka:kafka-clients",
    "com.rabbitmq:amqp-client",
  ],
  database: [
    "gorm.io/gorm",
    "github.com/jmoiron/sqlx",
    "entgo.io/ent",
    "github.com/uptrace/bun",
    "org.hibernate.orm:hibernate-core",
    "org.hibernate:hibernate-core",
    "org.mybatis:mybatis",
    "org.jooq:jooq",
  ],
  tests: ["github.com/stretchr/testify", "junit:junit", "org.junit.jupiter:junit-jupiter", "org.testng:testng"],
  "web server": [
    "github.com/gin-gonic/gin",
    "github.com/labstack/echo",
    "github.com/gofiber/fiber",
    "github.com/go-chi/chi",
    "github.com/gorilla/mux",
    "org.springframework.boot:spring-boot-starter-web",
    "io.javalin:javalin",
    "io.micronaut:micronaut-http-server-netty",
  ],
  ids: ["github.com/google/uuid", "github.com/oklog/ulid"],
};

const GO_MAJOR = /\/v\d+$/;

export const goModuleCandidates = (name: string): readonly string[] => {
  const parts = name.replace(GO_MAJOR, "").split("/");
  if (parts.length < 2 || !(parts[0] ?? "").includes(".")) return [];
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("/")).filter((item) => item.includes("/"));
};

const GO_IMPORT_BLOCK = /^\s*import\s*\(([\s\S]*?)^\s*\)/gm;
const GO_IMPORT_LINE = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm;
const QUOTED = /"([^"]+)"/g;

export const goImports = (text: string): readonly string[] =>
  [
    ...new Set([
      ...[...text.matchAll(GO_IMPORT_BLOCK)].flatMap((block) =>
        [...(block[1] ?? "").matchAll(QUOTED)].map((match) => match[1] ?? ""),
      ),
      ...[...text.matchAll(GO_IMPORT_LINE)].map((match) => match[1] ?? ""),
    ]),
  ].filter((item) => item !== "");

const JAVA_PACKAGES: Readonly<Record<string, string>> = {
  okhttp3: "com.squareup.okhttp3:okhttp",
  "org.apache.http": "org.apache.httpcomponents:httpclient",
  "org.apache.hc.client5": "org.apache.httpcomponents.client5:httpclient5",
  retrofit2: "com.squareup.retrofit2:retrofit",
  "org.asynchttpclient": "org.asynchttpclient:async-http-client",
  "kong.unirest": "com.konghq:unirest-java",
  "org.joda.time": "joda-time:joda-time",
  "org.hibernate.validator": "org.hibernate.validator:hibernate-validator",
  "ch.qos.logback": "ch.qos.logback:logback-classic",
  "org.apache.logging.log4j": "org.apache.logging.log4j:log4j-core",
  "redis.clients.jedis": "redis.clients:jedis",
  "io.lettuce.core": "io.lettuce:lettuce-core",
  "com.github.benmanes.caffeine": "com.github.ben-manes.caffeine:caffeine",
  "org.apache.kafka": "org.apache.kafka:kafka-clients",
  "com.rabbitmq.client": "com.rabbitmq:amqp-client",
  "org.hibernate": "org.hibernate.orm:hibernate-core",
  "org.apache.ibatis": "org.mybatis:mybatis",
  "org.jooq": "org.jooq:jooq",
  "org.junit.jupiter": "org.junit.jupiter:junit-jupiter",
  "org.junit": "junit:junit",
  "org.testng": "org.testng:testng",
  "org.springframework.web": "org.springframework.boot:spring-boot-starter-web",
  "io.javalin": "io.javalin:javalin",
  "io.micronaut.http.server": "io.micronaut:micronaut-http-server-netty",
};

const JAVA_IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+)/gm;

export const JVM_SOURCE = /\.(java|kt)$/;

export const javaArtifactOf = (name: string): string | undefined => {
  const parts = name.split(".");
  const prefix = parts
    .map((_, index) => parts.slice(0, parts.length - index).join("."))
    .find((candidate) => Object.hasOwn(JAVA_PACKAGES, candidate));
  return prefix === undefined ? undefined : JAVA_PACKAGES[prefix];
};

export const javaImports = (text: string): readonly string[] => [
  ...new Set(
    [...text.matchAll(JAVA_IMPORT)].flatMap((match) => {
      const artifact = javaArtifactOf(match[1] ?? "");
      return artifact === undefined ? [] : [artifact];
    }),
  ),
];
