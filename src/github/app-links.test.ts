import { describe, expect, it } from "vitest";
import { appPermissionsUrl, installationSettingsUrl } from "./app-links";
import type { InstallationAccount } from "./installations";
import type { OwnerAccount } from "./owner";

const USER: OwnerAccount = { id: 583_231, login: "octocat", type: "User" };
const ORGANIZATION: OwnerAccount = { id: 9_919, login: "Octo-Org", type: "Organization" };

describe("appPermissionsUrl", () => {
  it("appPermissionsUrl builds the personal and organization page", () => {
    expect(appPermissionsUrl(USER, "seluna-demo"), "personal account").toBe(
      "https://github.com/settings/apps/seluna-demo/permissions",
    );
    expect(appPermissionsUrl(ORGANIZATION, "seluna-demo"), "organization").toBe(
      "https://github.com/organizations/Octo-Org/settings/apps/seluna-demo/permissions",
    );
  });

  it("appPermissionsUrl accepts a slug of 100 characters", () => {
    const url = appPermissionsUrl(USER, "a".repeat(100));

    expect(url, "url").toBe(`https://github.com/settings/apps/${"a".repeat(100)}/permissions`);
  });

  it.each([
    { case: "a slug with capital letters", owner: USER, slug: "Seluna" },
    { case: "a slug with a slash", owner: USER, slug: "a/b" },
    { case: "a slug that is a dot", owner: USER, slug: "." },
    { case: "a slug that is dot dot", owner: ORGANIZATION, slug: ".." },
    { case: "an encoded dot dot slug", owner: USER, slug: "%2e%2e" },
    { case: "a slug with a question mark", owner: USER, slug: "a?b" },
    { case: "a slug with a number sign", owner: ORGANIZATION, slug: "a#b" },
    { case: "a slug with a space", owner: USER, slug: "a b" },
    { case: "a slug with a trailing line feed", owner: USER, slug: "seluna\n" },
    { case: "an empty slug", owner: USER, slug: "" },
    { case: "a slug of 101 characters", owner: USER, slug: "a".repeat(101) },
    { case: "an organization login with a slash", owner: { ...ORGANIZATION, login: "octo/org" }, slug: "seluna" },
    { case: "an organization login that is dot dot", owner: { ...ORGANIZATION, login: ".." }, slug: "seluna" },
    {
      case: "an organization login with a trailing hyphen",
      owner: { ...ORGANIZATION, login: "octo-" },
      slug: "seluna",
    },
    {
      case: "an organization login of 40 characters",
      owner: { ...ORGANIZATION, login: "a".repeat(40) },
      slug: "seluna",
    },
    { case: "an organization login with a question mark", owner: { ...ORGANIZATION, login: "o?x" }, slug: "seluna" },
    { case: "an empty organization login", owner: { ...ORGANIZATION, login: "" }, slug: "seluna" },
  ])("appPermissionsUrl gives no link for $case", ({ owner, slug }) => {
    const url = appPermissionsUrl(owner, slug);

    expect(url, "url").toBeUndefined();
  });
});

describe("installationSettingsUrl", () => {
  it("installationSettingsUrl builds the user and organization page", () => {
    const user = installationSettingsUrl({ kind: "login", login: "octocat", type: "User" }, 1_000_003);
    const organization = installationSettingsUrl({ kind: "login", login: "Octo-Org", type: "Organization" }, 42);

    expect(user, "user account").toBe("https://github.com/settings/installations/1000003");
    expect(organization, "organization").toBe("https://github.com/organizations/Octo-Org/settings/installations/42");
  });

  it.each<{ case: string; account: InstallationAccount; id: number }>([
    { case: "an enterprise account", account: { kind: "enterprise", slug: "acme" }, id: 1 },
    { case: "an unknown account", account: { kind: "unknown" }, id: 1 },
    { case: "the type Bot", account: { kind: "login", login: "robot", type: "Bot" }, id: 1 },
    { case: "no type", account: { kind: "login", login: "octocat", type: undefined }, id: 1 },
    { case: "the type user in lowercase", account: { kind: "login", login: "octocat", type: "user" }, id: 1 },
    {
      case: "an organization login with a slash",
      account: { kind: "login", login: "a/b", type: "Organization" },
      id: 1,
    },
    {
      case: "an organization login that is dot dot",
      account: { kind: "login", login: "..", type: "Organization" },
      id: 1,
    },
    {
      case: "an organization login with a trailing hyphen",
      account: { kind: "login", login: "a-", type: "Organization" },
      id: 1,
    },
    {
      case: "an organization login of 40 characters",
      account: { kind: "login", login: "a".repeat(40), type: "Organization" },
      id: 1,
    },
    {
      case: "an organization login with a trailing line feed",
      account: { kind: "login", login: "a\n", type: "Organization" },
      id: 1,
    },
    { case: "a user login with a slash", account: { kind: "login", login: "a/b", type: "User" }, id: 1 },
    { case: "a user login of 40 characters", account: { kind: "login", login: "a".repeat(40), type: "User" }, id: 1 },
    { case: "an installation id of 0", account: { kind: "login", login: "octocat", type: "User" }, id: 0 },
    { case: "a negative installation id", account: { kind: "login", login: "octocat", type: "User" }, id: -1 },
    { case: "a fractional installation id", account: { kind: "login", login: "octocat", type: "User" }, id: 1.5 },
    {
      case: "an installation id beyond the safe integers",
      account: { kind: "login", login: "octocat", type: "User" },
      id: 2 ** 53,
    },
    {
      case: "an installation id of NaN",
      account: { kind: "login", login: "octo-org", type: "Organization" },
      id: Number.NaN,
    },
  ])("installationSettingsUrl gives no link for $case", ({ account, id }) => {
    const url = installationSettingsUrl(account, id);

    expect(url, "url").toBeUndefined();
  });
});
