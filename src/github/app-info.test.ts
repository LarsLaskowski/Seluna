import { describe, expect, it } from "vitest";
import {
  accessToCheck,
  hasMissing,
  MANIFEST_ACCESS,
  missingAccess,
  parseAppInfo,
  parseGrantedAccess,
  readAppInfo,
} from "./app-info";
import type { GrantedAccess } from "./app-info";
import { MAX_GITHUB_RESPONSE_BYTES } from "./conversion";
import {
  appBody,
  FIXTURE_APP_ID,
  FULL_EVENTS,
  FULL_PERMISSIONS,
  githubApiDouble,
  jsonAnswer,
  REJECTED,
} from "../../test/github";
import type { GitHubAnswer } from "../../test/github";

const VERSION = "1.2.3-test";
const JWT = "header.claims.signature";

/** The access of the manifest minus the named permissions and events. */
function fullWithout(permissions: readonly string[], events: readonly string[]): GrantedAccess {
  return {
    permissions: Object.fromEntries(Object.entries(FULL_PERMISSIONS).filter(([name]) => !permissions.includes(name))),
    events: FULL_EVENTS.filter((event) => !events.includes(event)),
  };
}

describe("MANIFEST_ACCESS", () => {
  it("MANIFEST_ACCESS is the access of the manifest, in manifest order", () => {
    expect(JSON.stringify(MANIFEST_ACCESS.permissions), "permissions").toBe(JSON.stringify(FULL_PERMISSIONS));
    expect(MANIFEST_ACCESS.events, "events").toEqual(FULL_EVENTS);
  });
});

describe("parseGrantedAccess", () => {
  it("parseGrantedAccess narrows permissions and events", () => {
    const access = parseGrantedAccess({ metadata: "read", issues: "write" }, ["issues", "star"]);

    expect(access, "access").toEqual({
      permissions: { metadata: "read", issues: "write" },
      events: ["issues", "star"],
    });
  });

  it("parseGrantedAccess copies only the answer's own entries", () => {
    class Granted {
      // eslint-disable-next-line @typescript-eslint/class-literal-property-style -- an inherited accessor, not an own field, is what the test needs
      get contents(): string {
        return "read";
      }
    }
    const permissions: unknown = Object.assign(new Granted(), { metadata: "read" });

    const access = parseGrantedAccess(permissions, []);

    expect(Object.keys(access?.permissions ?? {}), "names").toEqual(["metadata"]);
    expect(access?.permissions.contents, "an inherited entry").toBeUndefined();
  });

  it.each<{ case: string; permissions: unknown; events: unknown }>([
    { case: "permissions that are null", permissions: null, events: [] },
    { case: "permissions that are an array", permissions: ["metadata"], events: [] },
    { case: "permissions that are a text", permissions: "metadata", events: [] },
    { case: "a level that is not a string", permissions: { metadata: 1 }, events: [] },
    { case: "a level that is null", permissions: { metadata: null }, events: [] },
    { case: "missing permissions", permissions: undefined, events: [] },
    { case: "events that are not an array", permissions: {}, events: "issues" },
    { case: "events that are an object", permissions: {}, events: { issues: true } },
    { case: "an event that is not a string", permissions: {}, events: ["issues", 5] },
    { case: "missing events", permissions: {}, events: undefined },
  ])("parseGrantedAccess gives undefined for $case", ({ permissions, events }) => {
    const access = parseGrantedAccess(permissions, events);

    expect(access, "access").toBeUndefined();
  });
});

describe("parseAppInfo", () => {
  it("parseAppInfo narrows the real app object", () => {
    const app = parseAppInfo(appBody());

    expect(app?.appId, "App ID").toBe(FIXTURE_APP_ID);
    expect(app?.slug, "slug").toBe("sonarqubecloud");
    expect(app?.owner, "owner").toEqual({ id: 545_988, login: "SonarSource", type: "Organization" });
    expect(app?.access, "access").toEqual({
      permissions: {
        checks: "write",
        contents: "read",
        emails: "read",
        members: "read",
        metadata: "read",
        organization_copilot_seat_management: "read",
        pull_requests: "write",
        security_events: "write",
        statuses: "write",
      },
      events: ["code_scanning_alert", "organization", "pull_request", "push", "repository"],
    });
  });

  it.each<{ case: string; body: unknown }>([
    { case: "no id", body: appBody({ id: undefined }) },
    { case: "an id of 0", body: appBody({ id: 0 }) },
    { case: "a negative id", body: appBody({ id: -1 }) },
    { case: "an id that is a string", body: appBody({ id: "12526" }) },
    { case: "an id beyond the safe integers", body: appBody({ id: 2 ** 53 }) },
    { case: "permissions that are not an object", body: appBody({ permissions: "read" }) },
    { case: "permissions that are an array", body: appBody({ permissions: [] }) },
    { case: "missing permissions", body: appBody({ permissions: undefined }) },
    { case: "a level that is not a string", body: appBody({ permissions: { metadata: 1 } }) },
    { case: "events that are not an array", body: appBody({ events: "push" }) },
    { case: "missing events", body: appBody({ events: undefined }) },
    { case: "an event that is not a string", body: appBody({ events: ["push", 1] }) },
    { case: "null", body: null },
    { case: "an array", body: [appBody()] },
    { case: "a text", body: "app" },
  ])("parseAppInfo rejects $case", ({ body }) => {
    const app = parseAppInfo(body);

    expect(app, "app").toBeUndefined();
  });

  it.each([
    { case: "a type Bot", owner: { id: 1, login: "octocat", type: "Bot" } },
    { case: "an id of 0", owner: { id: 0, login: "octocat", type: "User" } },
    { case: "an id that is a string", owner: { id: "1", login: "octocat", type: "User" } },
    { case: "a login failing the allow-list", owner: { id: 1, login: "octo/cat", type: "User" } },
    { case: "no id (an enterprise)", owner: { slug: "acme", name: "Acme" } },
    { case: "null", owner: null },
    { case: "a text", owner: "octocat" },
  ])("parseAppInfo keeps the answer with an undefined owner when the owner is malformed: $case", ({ owner }) => {
    const app = parseAppInfo(appBody({ owner }));

    expect(app?.owner, "owner").toBeUndefined();
    expect(app?.appId, "the rest of the answer is kept").toBe(FIXTURE_APP_ID);
    expect(app?.access.events, "events").toEqual([
      "code_scanning_alert",
      "organization",
      "pull_request",
      "push",
      "repository",
    ]);
  });

  it("parseAppInfo keeps the answer with an undefined owner when the answer has no owner", () => {
    const app = parseAppInfo(appBody({ owner: undefined }));

    expect(app?.owner, "owner").toBeUndefined();
    expect(app?.appId, "App ID").toBe(FIXTURE_APP_ID);
  });

  it.each([
    { case: "capital letters", slug: "Octo-App" },
    { case: "a slash", slug: "a/b" },
    { case: "a dot", slug: "." },
    { case: "an encoded dot", slug: "%2e%2e" },
    { case: "a space", slug: "a b" },
    { case: "an empty text", slug: "" },
    { case: "101 characters", slug: "a".repeat(101) },
    { case: "a number", slug: 7 },
    { case: "null", slug: null },
  ])("parseAppInfo drops a slug outside the allow-list: $case", ({ slug }) => {
    const app = parseAppInfo(appBody({ slug }));

    expect(app?.slug, "slug").toBeUndefined();
    expect(app?.appId, "the rest of the answer is kept").toBe(FIXTURE_APP_ID);
  });

  it("parseAppInfo keeps a slug of 100 characters", () => {
    const app = parseAppInfo(appBody({ slug: "a".repeat(100) }));

    expect(app?.slug, "slug").toBe("a".repeat(100));
  });

  it("parseAppInfo leaves out a missing slug", () => {
    const app = parseAppInfo(appBody({ slug: undefined }));

    expect(app?.slug, "slug").toBeUndefined();
    expect(app?.appId, "the rest of the answer is kept").toBe(FIXTURE_APP_ID);
  });
});

describe("readAppInfo", () => {
  it("readAppInfo sends GET /app with the given JWT", async () => {
    const github = githubApiDouble({ app: jsonAnswer(200, appBody()) });

    await readAppInfo(github.fetch, VERSION, JWT);

    const [request, ...rest] = github.requests;
    expect(rest, "further requests").toEqual([]);
    expect(request?.method, "method").toBe("GET");
    expect(request?.url, "url").toBe("https://api.github.com/app");
    expect(request?.authorization, "Authorization").toBe(`Bearer ${JWT}`);
    expect(request?.headers.get("accept"), "Accept").toBe("application/vnd.github+json");
    expect(request?.headers.get("x-github-api-version"), "X-GitHub-Api-Version").toBe("2022-11-28");
    expect(request?.headers.get("user-agent"), "User-Agent").toBe("seluna/1.2.3-test");
    expect(request?.redirect, "redirect").toBe("manual");
    expect(request?.signal.aborted, "signal aborted").toBe(false);
    expect(request?.hasBody, "has a body").toBe(false);
  });

  it("readAppInfo reads the narrowed app", async () => {
    const github = githubApiDouble({ app: jsonAnswer(200, appBody()) });

    const result = await readAppInfo(github.fetch, VERSION, JWT);

    expect(result.kind, "result kind").toBe("read");
    expect(result.kind === "read" ? result.app.appId : undefined, "App ID").toBe(FIXTURE_APP_ID);
    expect(result.kind === "read" ? result.app.slug : undefined, "slug").toBe("sonarqubecloud");
  });

  const FAILED_ANSWERS: readonly { readonly case: string; readonly answer: GitHubAnswer }[] = [
    { case: "401", answer: jsonAnswer(401, { message: "Bad credentials" }) },
    { case: "403", answer: jsonAnswer(403, { message: "forbidden" }) },
    { case: "500", answer: jsonAnswer(500, { message: "Server Error" }) },
    {
      case: "a redirect",
      answer: { kind: "raw", status: 302, body: null, headers: { Location: "https://example.com/" } },
    },
    { case: "a rejection", answer: REJECTED },
    { case: "a timeout", answer: { kind: "reject", error: new DOMException("timed out", "TimeoutError") } },
    {
      case: "an oversized answer",
      answer: { kind: "raw", status: 200, body: `"${"a".repeat(MAX_GITHUB_RESPONSE_BYTES)}"` },
    },
    { case: "text that is not JSON", answer: { kind: "raw", status: 200, body: "not json" } },
    { case: "an answer that is not an app", answer: jsonAnswer(200, { message: "hello" }) },
    { case: "an app without an id", answer: jsonAnswer(200, appBody({ id: undefined })) },
    { case: "an app with unusable events", answer: jsonAnswer(200, appBody({ events: "push" })) },
  ];

  it.each(FAILED_ANSWERS)("readAppInfo fails on $case", async ({ answer }) => {
    const github = githubApiDouble({ app: answer });

    const result = await readAppInfo(github.fetch, VERSION, JWT);

    expect(result, "result").toEqual({ kind: "failed" });
  });
});

describe("missingAccess", () => {
  it("missingAccess names the permissions and events the granted access lacks, in manifest order", () => {
    const granted = fullWithout(["issues", "contents", "metadata"], ["star", "fork"]);

    const missing = missingAccess(granted, MANIFEST_ACCESS);

    expect(missing, "missing").toEqual({ permissions: ["contents", "issues", "metadata"], events: ["fork", "star"] });
  });

  it("missingAccess names nothing for the full access", () => {
    const missing = missingAccess({ permissions: FULL_PERMISSIONS, events: FULL_EVENTS }, MANIFEST_ACCESS);

    expect(missing, "missing").toEqual({ permissions: [], events: [] });
  });

  it("missingAccess names every wanted entry for an empty access", () => {
    const missing = missingAccess({ permissions: {}, events: [] }, MANIFEST_ACCESS);

    expect(missing.permissions, "permissions").toEqual(Object.keys(FULL_PERMISSIONS));
    expect(missing.events, "events").toEqual(FULL_EVENTS);
  });

  it("missingAccess counts write and admin as read", () => {
    const granted: GrantedAccess = {
      permissions: { ...FULL_PERMISSIONS, contents: "write", issues: "admin" },
      events: FULL_EVENTS,
    };

    const missing = missingAccess(granted, MANIFEST_ACCESS);

    expect(missing, "missing").toEqual({ permissions: [], events: [] });
  });

  it("missingAccess ignores permissions and events beyond the wanted ones", () => {
    const granted: GrantedAccess = {
      permissions: { ...FULL_PERMISSIONS, checks: "write", members: "read" },
      events: [...FULL_EVENTS, "push", "repository"],
    };

    const missing = missingAccess(granted, MANIFEST_ACCESS);

    expect(missing, "missing").toEqual({ permissions: [], events: [] });
  });

  it.each([
    { case: "none", level: "none" },
    { case: "READ in capitals", level: "READ" },
    { case: "an empty text", level: "" },
    { case: "a word of no level", level: "all" },
  ])("missingAccess counts an unknown level as missing: $case", ({ level }) => {
    const granted: GrantedAccess = { permissions: { ...FULL_PERMISSIONS, issues: level }, events: FULL_EVENTS };

    const missing = missingAccess(granted, MANIFEST_ACCESS);

    expect(missing, "missing").toEqual({ permissions: ["issues"], events: [] });
  });

  it("missingAccess lets a level satisfy every lower one and none above it", () => {
    const wanted: GrantedAccess = { permissions: { a: "read", b: "write", c: "write", d: "admin" }, events: [] };
    const granted: GrantedAccess = { permissions: { a: "admin", b: "write", c: "read", d: "write" }, events: [] };

    const missing = missingAccess(granted, wanted);

    expect(missing, "missing").toEqual({ permissions: ["c", "d"], events: [] });
  });

  it("missingAccess does not count an inherited name as granted", () => {
    const missing = missingAccess({ permissions: {}, events: [] }, { permissions: { toString: "read" }, events: [] });

    expect(missing.permissions, "permissions").toEqual(["toString"]);
  });
});

describe("accessToCheck", () => {
  it("accessToCheck leaves out what the app lacks", () => {
    const app: GrantedAccess = {
      permissions: { metadata: "read", issues: "read", checks: "write" },
      events: ["issues", "push"],
    };

    const wanted = accessToCheck(app);

    expect(wanted, "access to check").toEqual({
      permissions: { issues: "read", metadata: "read" },
      events: ["issues"],
    });
  });

  it("accessToCheck keeps the whole manifest for an app that has all of it", () => {
    const wanted = accessToCheck({ permissions: FULL_PERMISSIONS, events: FULL_EVENTS });

    expect(JSON.stringify(wanted.permissions), "permissions").toBe(JSON.stringify(FULL_PERMISSIONS));
    expect(wanted.events, "events").toEqual(FULL_EVENTS);
  });

  it("accessToCheck counts a higher level of the app as having the permission and leaves out an unknown level", () => {
    const app: GrantedAccess = { permissions: { contents: "write", issues: "none", metadata: "read" }, events: [] };

    const wanted = accessToCheck(app);

    expect(Object.keys(wanted.permissions), "permissions").toEqual(["contents", "metadata"]);
  });

  it("accessToCheck is empty for an app with nothing of the manifest", () => {
    const wanted = accessToCheck({ permissions: { checks: "write" }, events: ["push"] });

    expect(wanted, "access to check").toEqual({ permissions: {}, events: [] });
  });
});

describe("hasMissing", () => {
  it.each([
    { case: "nothing", missing: { permissions: [], events: [] }, expected: false },
    { case: "a permission", missing: { permissions: ["issues"], events: [] }, expected: true },
    { case: "an event", missing: { permissions: [], events: ["star"] }, expected: true },
    { case: "both", missing: { permissions: ["issues"], events: ["star"] }, expected: true },
  ])("hasMissing is $expected for $case", ({ missing, expected }) => {
    const any = hasMissing(missing);

    expect(any, "has missing").toBe(expected);
  });
});
