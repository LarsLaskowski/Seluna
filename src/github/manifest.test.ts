import { describe, expect, it } from "vitest";
import { appManifest, appName, isAccountName, manifestFormAction, parseAccountType } from "./manifest";
import { expectedManifestJson } from "../../test/github";

const ORIGIN = "https://seluna.example.workers.dev";
const STATE = `v1.personal.octocat.1700003600000.${"A".repeat(22)}.${"B".repeat(43)}`;

describe("appManifest", () => {
  it("appManifest requests exactly the six read-only permissions and the five events", () => {
    const manifest = appManifest(ORIGIN, "octocat");

    expect(JSON.stringify(manifest.default_permissions), "permissions in order").toBe(
      '{"actions":"read","pull_requests":"read","vulnerability_alerts":"read","security_events":"read","secret_scanning_alerts":"read","metadata":"read"}',
    );
    expect(manifest.default_events, "events in order").toEqual([
      "pull_request",
      "workflow_run",
      "dependabot_alert",
      "code_scanning_alert",
      "secret_scanning_alert",
    ]);
  });

  it("appManifest is private and points the webhook and the redirect at the instance origin", () => {
    const manifest = appManifest(ORIGIN, "octocat");

    expect(manifest.public, "public").toBe(false);
    expect(manifest.hook_attributes, "webhook").toEqual({ url: `${ORIGIN}/webhook`, active: true });
    expect(manifest.redirect_url, "redirect").toBe(`${ORIGIN}/setup/github/callback`);
    expect(manifest.url, "homepage").toBe("https://github.com/LarsLaskowski/Seluna");
    expect(JSON.stringify(manifest), "the whole manifest in key order").toBe(expectedManifestJson(ORIGIN, "octocat"));
  });
});

describe("appName", () => {
  it.each([
    { account: "octocat", expected: "seluna-octocat" },
    { account: "a", expected: "seluna-a" },
    { account: "a".repeat(27), expected: `seluna-${"a".repeat(27)}` },
    { account: "a".repeat(28), expected: `seluna-${"a".repeat(27)}` },
    { account: `abcdefghijklmnopqrstuvwxyz0${"1".repeat(12)}`, expected: "seluna-abcdefghijklmnopqrstuvwxyz0" },
  ])("appName prefixes seluna- and cuts the name to 34 characters: $account", ({ account, expected }) => {
    const name = appName(account);

    expect(name, "app name").toBe(expected);
    expect(name.length, "length").toBeLessThanOrEqual(34);
  });
});

describe("manifestFormAction", () => {
  it("manifestFormAction posts a personal account's manifest to github.com/settings/apps/new with the state", () => {
    const action = manifestFormAction("personal", "octocat", STATE);

    expect(action, "form action").toBe(`https://github.com/settings/apps/new?state=${STATE}`);
  });

  it("manifestFormAction posts an organization's manifest to its organization settings with the state", () => {
    const action = manifestFormAction("organization", "Octo-Org", STATE);

    expect(action, "form action").toBe(`https://github.com/organizations/Octo-Org/settings/apps/new?state=${STATE}`);
  });
});

describe("parseAccountType", () => {
  it.each([
    { text: "personal", expected: "personal" },
    { text: "organization", expected: "organization" },
    { text: "", expected: undefined },
    { text: "Personal", expected: undefined },
    { text: "ORGANIZATION", expected: undefined },
    { text: "user", expected: undefined },
    { text: "org", expected: undefined },
    { text: " personal", expected: undefined },
    { text: "personal\n", expected: undefined },
    { text: "organization ", expected: undefined },
  ])("parseAccountType accepts exactly personal and organization: $text gives $expected", ({ text, expected }) => {
    const type = parseAccountType(text);

    expect(type, "account type").toBe(expected);
  });
});

describe("isAccountName", () => {
  it.each([
    { name: "a" },
    { name: "A1" },
    { name: "a-b" },
    { name: "a--b" },
    { name: "Octo-Org" },
    { name: "a".repeat(39) },
    { name: `a${"-".repeat(37)}b` },
  ])("isAccountName accepts 1 to 39 letters, digits and inner hyphens: $name", ({ name }) => {
    const accepted = isAccountName(name);

    expect(accepted, "accepted").toBe(true);
  });

  it.each([
    { form: "empty", name: "" },
    { form: "40 characters", name: "a".repeat(40) },
    { form: "leading hyphen", name: "-a" },
    { form: "trailing hyphen", name: "a-" },
    { form: "slash", name: "a/b" },
    { form: "backslash", name: "a\\b" },
    { form: "dot", name: "." },
    { form: "dot dot", name: ".." },
    { form: "encoded dot dot", name: "%2e%2e" },
    { form: "encoded slash", name: "a%2Fb" },
    { form: "question mark", name: "a?b" },
    { form: "number sign", name: "a#b" },
    { form: "space inside", name: "a b" },
    { form: "leading space", name: " a" },
    { form: "trailing tab", name: "a\t" },
    { form: "line feed inside", name: "a\nb" },
    { form: "trailing line feed", name: "a\n" },
    { form: "dot inside", name: "a.b" },
    { form: "underscore", name: "a_b" },
    { form: "at sign", name: "a@b" },
    { form: "colon", name: "a:b" },
    { form: "umlaut", name: "ä" },
    { form: "fullwidth letter", name: "\uFF41" },
  ])("isAccountName rejects every form in the guard table: $form", ({ name }) => {
    const accepted = isAccountName(name);

    expect(accepted, "accepted").toBe(false);
  });
});
