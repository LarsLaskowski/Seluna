import { describe, expect, it } from "vitest";
import { parseOwnerAccount } from "./owner";

describe("parseOwnerAccount", () => {
  it.each([
    { name: "a User", owner: { id: 583_231, login: "octocat", type: "User" }, type: "User" },
    { name: "an Organization", owner: { id: 9_919, login: "Octo-Org", type: "Organization" }, type: "Organization" },
    { name: "a login of 39 characters", owner: { id: 1, login: "a".repeat(39), type: "User" }, type: "User" },
    { name: "the largest safe id", owner: { id: Number.MAX_SAFE_INTEGER, login: "a", type: "User" }, type: "User" },
  ])("parseOwnerAccount narrows $name", ({ owner, type }) => {
    const account = parseOwnerAccount({ ...owner, node_id: "ignored", site_admin: false });

    expect(account, "account").toEqual({ id: owner.id, login: owner.login, type });
  });

  it.each<{ case: string; value: unknown }>([
    { case: "an id of 0", value: { id: 0, login: "octocat", type: "User" } },
    { case: "a negative id", value: { id: -1, login: "octocat", type: "User" } },
    { case: "a fractional id", value: { id: 1.5, login: "octocat", type: "User" } },
    { case: "an id that is a string", value: { id: "1", login: "octocat", type: "User" } },
    { case: "an id beyond the safe range", value: { id: 2 ** 53, login: "octocat", type: "User" } },
    { case: "an infinite id", value: { id: Infinity, login: "octocat", type: "User" } },
    { case: "a missing id", value: { login: "octocat", type: "User" } },
    { case: "the type Bot", value: { id: 1, login: "octocat", type: "Bot" } },
    { case: "the type Enterprise", value: { id: 1, login: "octocat", type: "Enterprise" } },
    { case: "the type user in lowercase", value: { id: 1, login: "octocat", type: "user" } },
    { case: "a missing type", value: { id: 1, login: "octocat" } },
    { case: "a type that is not a string", value: { id: 1, login: "octocat", type: 1 } },
    { case: "a login with a trailing hyphen", value: { id: 1, login: "octocat-", type: "User" } },
    { case: "a login with a slash", value: { id: 1, login: "octo/cat", type: "User" } },
    { case: "a login with a trailing line feed", value: { id: 1, login: "octocat\n", type: "User" } },
    { case: "an empty login", value: { id: 1, login: "", type: "User" } },
    { case: "a login of 40 characters", value: { id: 1, login: "a".repeat(40), type: "User" } },
    { case: "a missing login", value: { id: 1, type: "User" } },
    { case: "a login that is not a string", value: { id: 1, login: 7, type: "User" } },
    { case: "null", value: null },
    { case: "undefined", value: undefined },
    { case: "an array", value: [{ id: 1, login: "octocat", type: "User" }] },
    { case: "a string", value: "octocat" },
    { case: "a number", value: 1 },
  ])("parseOwnerAccount rejects $case", ({ value }) => {
    const account = parseOwnerAccount(value);

    expect(account, "account").toBeUndefined();
  });
});
