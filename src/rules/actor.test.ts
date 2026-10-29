import { describe, expect, it } from "vitest";
import { isBotSender, isOwnAction } from "./actor";
import type { OwnerAccount } from "../github/owner";

const OWNER: OwnerAccount = { id: 1000, login: "example-owner", type: "User" };
const ORGANIZATION: OwnerAccount = { id: 1000, login: "example-org", type: "Organization" };

/** A payload whose `sender` has the given fields. */
function payloadOf(sender: unknown): unknown {
  return { action: "opened", sender };
}

describe("isOwnAction", () => {
  it("isOwnAction is true for the owner's sender id", () => {
    const own = isOwnAction(payloadOf({ id: 1000, login: "example-owner", type: "User" }), OWNER);

    expect(own, "own action").toBe(true);
  });

  it("isOwnAction is true for a renamed login with the owner's id", () => {
    const own = isOwnAction(payloadOf({ id: 1000, login: "renamed-owner", type: "User" }), OWNER);

    expect(own, "own action").toBe(true);
  });

  it.each<{ case: string; payload: unknown; owner: OwnerAccount | undefined }>([
    { case: "another user", payload: payloadOf({ id: 2000, login: "example-owner", type: "User" }), owner: OWNER },
    { case: "a bot", payload: payloadOf({ id: 2000, login: "dependabot[bot]", type: "Bot" }), owner: OWNER },
    {
      case: "an organization owner",
      payload: payloadOf({ id: 1000, login: "example-org", type: "User" }),
      owner: ORGANIZATION,
    },
    {
      case: "an unknown owner",
      payload: payloadOf({ id: 1000, login: "example-owner", type: "User" }),
      owner: undefined,
    },
    { case: "no sender", payload: { action: "opened" }, owner: OWNER },
    { case: "a sender that is null", payload: payloadOf(null), owner: OWNER },
    { case: "a sender that is a string", payload: payloadOf("example-owner"), owner: OWNER },
    { case: "a sender that is an array", payload: payloadOf([{ id: 1000 }]), owner: OWNER },
    { case: "a sender without an id", payload: payloadOf({ login: "example-owner", type: "User" }), owner: OWNER },
    { case: "a sender id that is a string", payload: payloadOf({ id: "1000", type: "User" }), owner: OWNER },
    { case: "a sender id that is NaN", payload: payloadOf({ id: Number.NaN, type: "User" }), owner: OWNER },
    { case: "a payload that is null", payload: null, owner: OWNER },
    { case: "a payload that is a string", payload: "payload", owner: OWNER },
    { case: "a payload that is an array", payload: [], owner: OWNER },
  ])("isOwnAction is false for $case", ({ payload, owner }) => {
    const own = isOwnAction(payload, owner);

    expect(own, "own action").toBe(false);
  });
});

describe("isBotSender", () => {
  it("isBotSender is true for sender.type Bot", () => {
    const bot = isBotSender(payloadOf({ id: 49_699_333, login: "dependabot[bot]", type: "Bot" }));

    expect(bot, "bot").toBe(true);
  });

  it.each<{ case: string; payload: unknown }>([
    { case: "a user", payload: payloadOf({ id: 1000, login: "example-owner", type: "User" }) },
    { case: "an organization sender", payload: payloadOf({ id: 1000, login: "example-org", type: "Organization" }) },
    { case: "no sender", payload: { action: "opened" } },
    { case: "a sender that is null", payload: payloadOf(null) },
    { case: "a sender that is a string", payload: payloadOf("Bot") },
    { case: "a sender that is an array", payload: payloadOf([{ type: "Bot" }]) },
    { case: "a sender without a type", payload: payloadOf({ id: 1000, login: "example-owner" }) },
    { case: "a type that is not a string", payload: payloadOf({ id: 1000, type: 1 }) },
    { case: "a type that is an object", payload: payloadOf({ id: 1000, type: { name: "Bot" } }) },
    { case: "a type bot in lowercase", payload: payloadOf({ id: 1000, type: "bot" }) },
    { case: "a type Bot with a trailing space", payload: payloadOf({ id: 1000, type: "Bot " }) },
    { case: "a login ending in [bot] on a user", payload: payloadOf({ id: 1000, login: "x[bot]", type: "User" }) },
    { case: "a payload that is null", payload: null },
    { case: "a payload that is a string", payload: "Bot" },
    { case: "a payload that is an array", payload: [] },
  ])("isBotSender is false for $case", ({ payload }) => {
    const bot = isBotSender(payload);

    expect(bot, "bot").toBe(false);
  });
});
