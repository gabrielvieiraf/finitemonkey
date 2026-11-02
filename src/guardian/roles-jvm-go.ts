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
