import { describe, expect, it, vi } from "vitest";
import { runRules } from "./rule";
import type { Notification, Rule, WebhookPayload } from "./rule";
import { DEFAULT_SETTINGS } from "../settings";
import type { NotificationSettings, RuleId } from "../settings";

const PAYLOAD: WebhookPayload = { zen: "Encourage flow." };

function notification(title: string): Notification {
  return {
    title,
    repository: "octo/repo",
    number: 7,
    subject: "Subject",
    context: "Context",
    url: "https://github.com/octo/repo/pull/7",
  };
}

type Evaluate = Rule["evaluate"];

function ruleOf(id: RuleId, result: Notification | undefined) {
  const evaluate = vi.fn<Evaluate>(() => result);
  const rule: Rule = { id, evaluate };
  return { rule, evaluate };
}

function withRuleOff(id: RuleId): NotificationSettings {
  return { ...DEFAULT_SETTINGS, rules: { ...DEFAULT_SETTINGS.rules, [id]: false } };
}

describe("runRules", () => {
  it("runRules passes the event name, the payload and the settings to every rule", () => {
    const first = ruleOf("pull_request_opened", undefined);
    const second = ruleOf("ci_failed_default_branch", undefined);

    runRules([first.rule, second.rule], "ping", PAYLOAD, DEFAULT_SETTINGS);

    expect(first.evaluate, "first rule arguments").toHaveBeenCalledExactlyOnceWith("ping", PAYLOAD, DEFAULT_SETTINGS);
    expect(second.evaluate, "second rule arguments").toHaveBeenCalledExactlyOnceWith("ping", PAYLOAD, DEFAULT_SETTINGS);
  });

  it("runRules returns the notifications of enabled rules in rule order with decision reported", () => {
    const first = ruleOf("pull_request_opened", notification("First"));
    const none = ruleOf("pull_request_ready_for_review", undefined);
    const third = ruleOf("dependabot_alert", notification("Third"));

    const run = runRules([first.rule, none.rule, third.rule], "ping", PAYLOAD, DEFAULT_SETTINGS);

    expect(run.notifications, "notifications").toEqual([notification("First"), notification("Third")]);
    expect(run.decision, "decision").toBe("reported");
  });

  it("runRules drops the notification of a disabled rule and returns decision disabled", () => {
    const disabled = ruleOf("pull_request_opened", notification("Dropped"));

    const run = runRules([disabled.rule], "ping", PAYLOAD, withRuleOff("pull_request_opened"));

    expect(run.notifications, "notifications").toEqual([]);
    expect(run.decision, "decision").toBe("disabled");
  });

  it("runRules returns decision reported when an enabled and a disabled rule both match", () => {
    const disabled = ruleOf("pull_request_opened", notification("Dropped"));
    const enabled = ruleOf("dependabot_alert", notification("Kept"));

    const run = runRules([disabled.rule, enabled.rule], "ping", PAYLOAD, withRuleOff("pull_request_opened"));

    expect(run.notifications, "notifications").toEqual([notification("Kept")]);
    expect(run.decision, "decision").toBe("reported");
  });

  it("runRules returns no-match when no rule returns a notification", () => {
    const first = ruleOf("pull_request_opened", undefined);
    const second = ruleOf("dependabot_alert", undefined);

    const run = runRules([first.rule, second.rule], "ping", PAYLOAD, DEFAULT_SETTINGS);

    expect(run.notifications, "notifications").toEqual([]);
    expect(run.decision, "decision").toBe("no-match");
  });
});
