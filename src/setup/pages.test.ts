import { describe, expect, it } from "vitest";
import type { Language } from "./language";
import {
  contentSecurityPolicy,
  escapeHtml,
  htmlResponse,
  renderGitHubFinishPage,
  renderGitHubPage,
  renderGitHubReviewPage,
  renderLoginPage,
  renderNotConfiguredPage,
  renderStartPage,
  renderTelegramPage,
  STYLE,
} from "./pages";
import type { GitHubPageView, TelegramPageView } from "./pages";
import { DEFAULT_SETTINGS, RULE_IDS } from "../settings";
import type { NotificationSettings } from "../settings";
import type { StatusView } from "./status";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";
import type { TelegramChat } from "../telegram";

const LANGUAGES: readonly Language[] = ["en", "de"];
const NOTICES: readonly Notice[] = [
  "wrong-secret",
  "locked",
  "form-expired",
  "unavailable",
  "migrations-missing",
  "github-invalid-account",
  "github-return-invalid",
  "github-state-invalid",
  "github-code-rejected",
  "github-unavailable",
  "github-answer-invalid",
  "github-owner-mismatch",
  "github-store-failed",
  "settings-invalid",
  "reset-not-needed",
];
const CSRF_TOKEN = "T".repeat(43);

const TELEGRAM_LINK = "/setup/telegram";
const GITHUB_LINK = "/setup/github";
const CHATS: readonly TelegramChat[] = [
  { id: 5_001_001, kind: "private", name: "Anna Beispiel", username: "anna_example" },
  { id: -4_001_001, kind: "group", name: "Seluna Testgroup", username: undefined },
];
const CHATS_VIEW: TelegramPageView = { kind: "chats", chats: CHATS, savedChatId: undefined };
const NO_CHATS_VIEW: TelegramPageView = { kind: "chats", chats: [], savedChatId: -1_001_234_567_890 };
const CODE_VIEW: TelegramPageView = {
  kind: "code",
  chatId: 5_001_001,
  proof: `v1.5001001.1700000600000.${"A".repeat(43)}`,
};

/** Every page in each language, with the links it has besides the two language links. */
const PAGES = LANGUAGES.flatMap((language) => [
  { page: "login", language, links: [] as string[], html: () => renderLoginPage(language, CSRF_TOKEN) },
  {
    page: "start",
    language,
    links: [TELEGRAM_LINK, GITHUB_LINK],
    html: () => renderStartPage(language, CSRF_TOKEN, { kind: "notice-only" }),
  },
  { page: "not-configured", language, links: [] as string[], html: () => renderNotConfiguredPage(language) },
  {
    page: "telegram chats",
    language,
    links: [TELEGRAM_LINK],
    html: () => renderTelegramPage(language, CSRF_TOKEN, CHATS_VIEW),
  },
  {
    page: "telegram no chats",
    language,
    links: [TELEGRAM_LINK],
    html: () => renderTelegramPage(language, CSRF_TOKEN, NO_CHATS_VIEW),
  },
  {
    page: "telegram code",
    language,
    links: [TELEGRAM_LINK],
    html: () => renderTelegramPage(language, CSRF_TOKEN, CODE_VIEW),
  },
  {
    page: "telegram notice-only",
    language,
    links: [TELEGRAM_LINK],
    html: () => renderTelegramPage(language, CSRF_TOKEN, { kind: "notice-only" }, "telegram-send-failed"),
  },
]);

/** Base64 (with padding) of the SHA-256 of the UTF-8 bytes of `text`. */
async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(Array.from(digest, (byte) => String.fromCharCode(byte)).join(""));
}

/** The values of the attributes `name` in `html`. */
function attributeValues(html: string, name: string): string[] {
  return Array.from(html.matchAll(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "gi")), (match) => match[1] ?? "");
}

describe("contentSecurityPolicy", () => {
  it("contentSecurityPolicy for github allows forms to post to https://github.com only", async () => {
    const expected = (await contentSecurityPolicy()).replace("form-action 'self'", "form-action https://github.com");

    const policy = await contentSecurityPolicy("github");

    expect(policy, "policy").toBe(expected);
    expect(policy, "form-action").toContain("form-action https://github.com;");
    expect(policy, "self").not.toContain("'self'");
  });
});

describe("htmlResponse", () => {
  it("htmlResponse sets the security headers, Content-Type and Content-Language", async () => {
    expect(STYLE.length, "length of STYLE").toBeGreaterThan(0);
    const expectedPolicy =
      `default-src 'none'; style-src 'sha256-${await sha256Base64(STYLE)}'; form-action 'self'; ` +
      "frame-ancestors 'none'; base-uri 'none'";

    const response = await htmlResponse("<p>page</p>", 403, "de", ["a=b", "c=d"]);

    expect(response.status, "status").toBe(403);
    expect(await response.text(), "body").toBe("<p>page</p>");
    expect(response.headers.get("Content-Security-Policy"), "Content-Security-Policy").toBe(expectedPolicy);
    expect(response.headers.get("X-Content-Type-Options"), "X-Content-Type-Options").toBe("nosniff");
    expect(response.headers.get("X-Frame-Options"), "X-Frame-Options").toBe("DENY");
    expect(response.headers.get("Referrer-Policy"), "Referrer-Policy").toBe("no-referrer");
    expect(response.headers.get("Cache-Control"), "Cache-Control").toBe("no-store");
    expect(response.headers.get("Content-Type"), "Content-Type").toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Language"), "Content-Language").toBe("de");
    expect(response.headers.getSetCookie(), "Set-Cookie").toEqual(["a=b", "c=d"]);
  });
});

describe("the pages", () => {
  it.each(PAGES)(
    "the $page page in $language has no script, no external resource and exactly one style element",
    ({ html }) => {
      const page = html();

      expect(STYLE.length, "length of STYLE").toBeGreaterThan(0);
      expect(page.toLowerCase(), "page text").not.toMatch(/<(?:script|link|img|iframe)\b/);
      expect(
        [...attributeValues(page, "src"), ...attributeValues(page, "href"), ...attributeValues(page, "action")].filter(
          (value) => /^(?:https?:)?\/\//i.test(value),
        ),
        "external addresses in src, href and action",
      ).toEqual([]);
      expect(page.match(/<style[\s>]/gi)?.length, "number of style elements").toBe(1);
      expect(page, "the style element").toContain(`<style>${STYLE}</style>`);
    },
  );

  it.each(PAGES)("the $page page in $language sets html lang to $language", ({ html, language }) => {
    const page = html();

    expect(page, "page").toContain(`<html lang="${language}">`);
  });

  it.each(PAGES)(
    "the $page page in $language links to /setup?lang=en, /setup?lang=de and its own links only",
    ({ html, links }) => {
      const page = html();

      expect(
        attributeValues(page, "href").sort((left, right) => left.localeCompare(right)),
        "href values",
      ).toEqual([...links, "/setup?lang=de", "/setup?lang=en"].sort((left, right) => left.localeCompare(right)));
    },
  );
});

describe("escapeHtml", () => {
  it("escapeHtml escapes & < > \" and '", () => {
    const escaped = escapeHtml(`&<>"'`);

    expect(escaped, "escaped text").toMatch(/^&amp;&lt;&gt;&(?:quot|#34|#x22);&(?:apos|#39|#x27);$/);
  });
});

describe("renderLoginPage", () => {
  it.each(NOTICES.flatMap((notice) => LANGUAGES.map((language) => ({ notice, language }))))(
    "renderLoginPage shows the $notice notice in $language",
    ({ notice, language }) => {
      const text = TEXTS[language].notices[notice];
      expect(text.length, "length of the notice text").toBeGreaterThan(0);

      const page = renderLoginPage(language, CSRF_TOKEN, notice);

      expect(page, "page").toContain(escapeHtml(text));
    },
  );
});

describe("renderStartPage", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage links to the Telegram step in $language",
    ({ language }) => {
      const page = renderStartPage(language, CSRF_TOKEN, { kind: "notice-only" });

      expect(page, "link to the Telegram step with the Telegram heading as text").toContain(
        `<a href="/setup/telegram">${escapeHtml(TEXTS[language].telegramHeading)}</a>`,
      );
    },
  );
});

describe("renderTelegramPage", () => {
  it("renderTelegramPage escapes each chat name and wraps it in bdi", () => {
    const names = ["<img src=x onerror=alert(1)>", `A & "B" 'C' </bdi><b>`, "\u202Eevil"];
    const chats: TelegramChat[] = names.map((name, index) => ({
      id: 100 + index,
      kind: "group",
      name,
      username: undefined,
    }));

    const page = renderTelegramPage("en", CSRF_TOKEN, { kind: "chats", chats, savedChatId: undefined });

    expect(page, "unescaped markup from a name").not.toMatch(/<img\b|<b>/);
    expect(
      Array.from(page.matchAll(/<bdi>([^<]*)<\/bdi>/g), (match) => match[1]),
      "contents of the bdi elements without attributes: the escaped names",
    ).toEqual(names.map((name) => escapeHtml(name)));
  });

  it("renderTelegramPage shows the username in an element of its own after the name", () => {
    const chats: TelegramChat[] = [
      { id: 5_001_001, kind: "private", name: "Anna Beispiel", username: "anna_example" },
      { id: 5_002_002, kind: "private", name: "Mallory @anna_example", username: undefined },
    ];

    const page = renderTelegramPage("en", CSRF_TOKEN, { kind: "chats", chats, savedChatId: undefined });

    const nameIndex = page.indexOf("<bdi>Anna Beispiel</bdi>");
    const usernameIndex = page.indexOf('<bdi class="username">@anna_example</bdi>');
    expect(nameIndex, "name element found").toBeGreaterThanOrEqual(0);
    expect(usernameIndex, "username element comes after the name element").toBeGreaterThan(nameIndex);
    expect(page.match(/<bdi class="username">/g)?.length, "number of username elements").toBe(1);
    expect(page, "name that imitates a username stays in the name element").toContain(
      "<bdi>Mallory @anna_example</bdi>",
    );
  });

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderTelegramPage shows the notice of a notice-only view in $language",
    ({ language }) => {
      const page = renderTelegramPage(language, CSRF_TOKEN, { kind: "notice-only" }, "telegram-token-rejected");

      expect(page, "notice").toContain(escapeHtml(TEXTS[language].notices["telegram-token-rejected"]));
      expect(page, "heading").toContain(`<h1>${escapeHtml(TEXTS[language].telegramHeading)}</h1>`);
      expect(page, "form").not.toContain("<form");
    },
  );
});

describe("renderStartPage GitHub step", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage links to the GitHub step in $language",
    ({ language }) => {
      const page = renderStartPage(language, CSRF_TOKEN, { kind: "notice-only" });

      expect(page, "link to the GitHub step with the GitHub heading as text").toContain(
        `<a href="/setup/github">${escapeHtml(TEXTS[language].githubHeading)}</a>`,
      );
    },
  );
});

const GITHUB_STATE = `v1.personal.octocat.1700003600000.${"A".repeat(22)}.${"B".repeat(43)}`;
const REVIEW_ACTION = `https://github.com/settings/apps/new?state=${GITHUB_STATE}`;
const INSTALL_LINK = "https://github.com/apps/octoapp/installations/new";

/**
 * Every GitHub page in each language, with the addresses it may link to besides the two language links and the
 * external addresses it must carry (the install link, the form action to github.com).
 */
const GITHUB_PAGES = LANGUAGES.flatMap((language) => {
  const view = (value: GitHubPageView, notice?: Notice): (() => string) => {
    return () => renderGitHubPage(language, CSRF_TOKEN, value, notice);
  };
  return [
    {
      page: "github form",
      language,
      links: [GITHUB_LINK],
      external: [] as string[],
      html: view({ kind: "form", savedAppId: undefined }),
    },
    {
      page: "github form with a saved app",
      language,
      links: [GITHUB_LINK],
      external: [] as string[],
      html: view({ kind: "form", savedAppId: 12_345 }, "github-invalid-account"),
    },
    {
      page: "github worker-secrets",
      language,
      links: [GITHUB_LINK],
      external: [] as string[],
      html: view({ kind: "worker-secrets" }),
    },
    {
      page: "github partial-worker-secrets",
      language,
      links: [GITHUB_LINK],
      external: [] as string[],
      html: view({ kind: "partial-worker-secrets" }),
    },
    {
      page: "github reset-needed",
      language,
      links: [GITHUB_LINK, "/setup"],
      external: [] as string[],
      html: view({ kind: "reset-needed" }),
    },
    {
      page: "github notice-only",
      language,
      links: [GITHUB_LINK],
      external: [] as string[],
      html: view({ kind: "notice-only" }, "github-return-invalid"),
    },
    {
      page: "github created",
      language,
      links: [GITHUB_LINK],
      external: [INSTALL_LINK],
      html: view({ kind: "created", slug: "octoapp" }),
    },
    {
      page: "github created without a slug",
      language,
      links: [GITHUB_LINK],
      external: [] as string[],
      html: view({ kind: "created", slug: undefined }),
    },
    {
      page: "github review",
      language,
      links: [] as string[],
      external: [REVIEW_ACTION],
      html: () =>
        renderGitHubReviewPage(
          language,
          { type: "personal", account: "octocat" },
          "seluna-octocat",
          REVIEW_ACTION,
          '{"name":"seluna-octocat"}',
        ),
    },
    {
      page: "github finish",
      language,
      links: [] as string[],
      external: [] as string[],
      html: () => renderGitHubFinishPage(language, "abc123", GITHUB_STATE, "github-unavailable"),
    },
  ];
});

describe("the GitHub pages", () => {
  it.each(GITHUB_PAGES)(
    "the $page page in $language has no script, one style element and no external address but its own",
    ({ html, external }) => {
      const page = html();

      expect(page.toLowerCase(), "page text").not.toMatch(/<(?:script|link|img|iframe)\b/);
      expect(page.match(/<style[\s>]/gi)?.length, "number of style elements").toBe(1);
      expect(page, "the style element").toContain(`<style>${STYLE}</style>`);
      expect(
        [...attributeValues(page, "src"), ...attributeValues(page, "href"), ...attributeValues(page, "action")].filter(
          (value) => /^(?:https?:)?\/\//i.test(value),
        ),
        "external addresses in src, href and action",
      ).toEqual(external);
    },
  );

  it.each(GITHUB_PAGES)("the $page page in $language sets html lang to $language", ({ html, language }) => {
    const page = html();

    expect(page, "page").toContain(`<html lang="${language}">`);
  });

  it.each(GITHUB_PAGES)(
    "the $page page in $language links to both languages and its own links only",
    ({ html, links, external }) => {
      const page = html();

      const hrefs = attributeValues(page, "href").filter((value) => !external.includes(value));
      expect(hrefs, "href values").toContain("/setup?lang=de");
      expect(hrefs, "href values").toContain("/setup?lang=en");
      expect(
        hrefs.filter((value) => !["/setup?lang=de", "/setup?lang=en", ...links].includes(value)),
        "other href values",
      ).toEqual([]);
    },
  );
});

describe("renderGitHubPage", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderGitHubPage reset-needed view links to the start page in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = renderGitHubPage(language, CSRF_TOKEN, { kind: "reset-needed" });

      expect(page, "reset text followed by the start page link").toContain(
        `<p>${escapeHtml(texts.githubResetNeeded)}</p>\n<p><a href="/setup">${escapeHtml(texts.startPageLink)}</a></p>`,
      );
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderGitHubPage shows the heading and the notice of a notice-only view with a link back to the step in $language",
    ({ language }) => {
      const page = renderGitHubPage(language, CSRF_TOKEN, { kind: "notice-only" }, "github-state-invalid");

      expect(page, "heading").toContain(`<h1>${escapeHtml(TEXTS[language].githubHeading)}</h1>`);
      expect(page, "notice").toContain(escapeHtml(TEXTS[language].notices["github-state-invalid"]));
      expect(page, "back link").toContain(`<a href="/setup/github">${escapeHtml(TEXTS[language].githubBackLink)}</a>`);
      expect(page, "form").not.toContain("<form");
    },
  );
});

describe("renderGitHubReviewPage", () => {
  it("renderGitHubReviewPage escapes the account, the app name, the form action and the manifest", () => {
    const account = "<u>acc</u>&\"x'";
    const name = "<s>name</s>&\"y'";
    const action = 'https://github.com/settings/apps/new?state="><script>alert(1)</script>';
    const manifest = '{"name":"<script>alert(2)</script>","x":"&\'"}';

    const page = renderGitHubReviewPage("en", { type: "organization", account }, name, action, manifest);

    expect(page, "unescaped markup").not.toMatch(/<(?:script|u|s)\b/);
    expect(page, "escaped account").toContain(escapeHtml(account));
    expect(page, "escaped app name").toContain(escapeHtml(name));
    expect(attributeValues(page, "action"), "form action attribute").toEqual([escapeHtml(action)]);
    expect(page, "manifest field").toMatch(hiddenInput("manifest", manifest));
  });

  it("renderGitHubReviewPage posts the manifest as its only field and has no csrf field", () => {
    const page = renderGitHubReviewPage(
      "en",
      { type: "personal", account: "octocat" },
      "seluna-octocat",
      REVIEW_ACTION,
      "{}",
    );

    expect(page.match(/<input\b/g)?.length, "number of inputs").toBe(1);
    expect(page, "csrf field").not.toContain('name="csrf"');
    expect(page, "method").toMatch(/<form\b[^>]*method="post"/);
  });
});

describe("renderGitHubFinishPage", () => {
  it("renderGitHubFinishPage escapes code and state and has no csrf field", () => {
    const code = 'a"><script>alert(1)</script>';
    const state = "v1.\"><b>x</b>&'";

    const page = renderGitHubFinishPage("en", code, state);

    expect(page, "unescaped markup").not.toMatch(/<(?:script|b)\b/);
    expect(page, "code field").toMatch(hiddenInput("code", code));
    expect(page, "state field").toMatch(hiddenInput("state", state));
    expect(page, "csrf field").not.toContain('name="csrf"');
    expect(attributeValues(page, "action"), "form action").toEqual(["/setup/github/callback"]);
    expect(page, "method").toMatch(/<form\b[^>]*method="post"/);
  });
});

/** Matches the hidden input `name` whose value is `value` as `escapeHtml` writes it, whatever the attribute order. */
function hiddenInput(name: string, value: string): RegExp {
  return new RegExp(
    `<input\\b(?=[^>]*type="hidden")(?=[^>]*name="${name}")(?=[^>]*value="${escapeRegExp(escapeHtml(value))}")[^>]*>`,
  );
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

const DELIVERY_AT_UTC = new Date(Date.UTC(2026, 9, 17, 12, 34));

function statusViewWith(changes: Partial<StatusView> = {}): StatusView {
  return {
    version: "1.2.3-test",
    chat: { kind: "saved", chatId: -1_001_234_567_890 },
    app: { kind: "saved", appId: 12_345, slug: "seluna-demo" },
    lastDelivery: DELIVERY_AT_UTC,
    resetNeeded: false,
    settings: DEFAULT_SETTINGS,
    installations: { kind: "hidden" },
    ...changes,
  };
}

function startPage(language: Language, changes: Partial<StatusView> = {}, notice?: Notice): string {
  return renderStartPage(language, CSRF_TOKEN, { kind: "status", status: statusViewWith(changes) }, notice);
}

/** The first `<input>` tag of `html` with the given name, or an empty text. */
function inputTag(html: string, name: string): string {
  return new RegExp(`<input\\b(?=[^>]*name="${name}")[^>]*>`).exec(html)?.[0] ?? "";
}

describe("renderStartPage status", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows the status lines in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language);

      expect(page, "status heading").toContain(escapeHtml(texts.statusHeading));
      expect(page, "version line").toMatch(new RegExp(`${escapeHtml(texts.versionLabel)}[\\s\\S]{0,40}1\\.2\\.3-test`));
      expect(page, "chat line").toMatch(
        new RegExp(`${escapeHtml(texts.telegramChatLabel)}[\\s\\S]{0,40}-1001234567890`),
      );
      expect(page, "app line").toContain(escapeHtml(texts.githubAppLabel));
      expect(page, "App ID").toContain(`(${escapeHtml(texts.appIdLabel)} 12345)`);
      expect(page, "delivery line").toMatch(
        new RegExp(`${escapeHtml(texts.lastDeliveryLabel)}[\\s\\S]{0,40}2026-10-17 12:34 \\(UTC\\)`),
      );
      const order = [
        texts.statusHeading,
        texts.versionLabel,
        texts.telegramChatLabel,
        texts.githubAppLabel,
        texts.lastDeliveryLabel,
        texts.settingsHeading,
      ].map((text) => page.indexOf(escapeHtml(text)));
      expect(order, "the status lines come in this order and before the settings").toEqual(
        [...order].sort((a, b) => a - b),
      );
      expect(Math.min(...order), "every text is on the page").toBeGreaterThanOrEqual(0);
    },
  );

  it("renderStartPage writes the last delivery in the time zone of the settings", () => {
    const settings: NotificationSettings = { ...DEFAULT_SETTINGS, timeZone: "Europe/Berlin" };

    const page = startPage("en", { settings });

    expect(page, "delivery time").toContain("2026-10-17 14:34 (Europe/Berlin)");
  });

  it("renderStartPage links and escapes the app slug", () => {
    const linked = startPage("en");
    const hostile = startPage("en", { app: { kind: "saved", appId: 12_345, slug: 'x"><script>y' } });

    expect(linked, "link to the app").toContain('<a href="https://github.com/apps/seluna-demo">seluna-demo</a>');
    expect(hostile, "raw script tag").not.toContain("<script>");
  });

  it.each([
    { case: "the Worker secret for the chat", changes: { chat: { kind: "secret" } }, key: "chatSecret" },
    { case: "no saved chat", changes: { chat: { kind: "none" } }, key: "noneSavedYet" },
    { case: "the GitHub Worker secrets", changes: { app: { kind: "worker-secrets" } }, key: "appSecrets" },
    { case: "some GitHub Worker secrets", changes: { app: { kind: "partial-worker-secrets" } }, key: "appPartial" },
    { case: "no saved app", changes: { app: { kind: "none" } }, key: "noneSavedYet" },
    { case: "an unreadable app", changes: { app: { kind: "unreadable" } }, key: "cannotBeRead" },
    { case: "no delivery yet", changes: { lastDelivery: undefined }, key: "noneReceivedYet" },
  ] as const)("renderStartPage shows the text for $case in English and German", ({ changes, key }) => {
    const english = startPage("en", changes);
    const german = startPage("de", changes);

    expect(english, "English text").toContain(escapeHtml(TEXTS.en[key]));
    expect(german, "German text").toContain(escapeHtml(TEXTS.de[key]));
  });

  it("renderStartPage shows an app without a slug by its App ID alone", () => {
    const page = startPage("en", { app: { kind: "saved", appId: 12_345, slug: undefined } });

    expect(page, "App ID").toContain(`${escapeHtml(TEXTS.en.appIdLabel)} 12345`);
    expect(page, "link to an app").not.toContain("https://github.com/apps/");
  });

  it("renderStartPage notice-only view carries the notice, the step links and the sign-out form", () => {
    const page = renderStartPage("en", CSRF_TOKEN, { kind: "notice-only" }, "unavailable");

    expect(page, "notice").toContain(escapeHtml(TEXTS.en.notices.unavailable));
    expect(page, "Telegram link").toContain(`<a href="/setup/telegram">${escapeHtml(TEXTS.en.telegramHeading)}</a>`);
    expect(page, "GitHub link").toContain(`<a href="/setup/github">${escapeHtml(TEXTS.en.githubHeading)}</a>`);
    expect(page, "sign-out form").toContain('action="/setup/logout"');
    expect(page, "settings form").not.toContain('action="/setup/settings"');
    expect(page, "status heading").not.toContain(escapeHtml(TEXTS.en.statusHeading));
  });

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows the notice above the status page in $language",
    ({ language }) => {
      const page = startPage(language, {}, "settings-invalid");

      expect(page, "notice").toContain(escapeHtml(TEXTS[language].notices["settings-invalid"]));
      expect(page, "status heading").toContain(escapeHtml(TEXTS[language].statusHeading));
    },
  );
});

describe("renderStartPage reset section", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows the reset section with its form when a reset is needed in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language, { resetNeeded: true, app: { kind: "unreadable" } });

      expect(page, "reset heading").toContain(escapeHtml(texts.resetHeading));
      expect(page, "reset text").toContain(escapeHtml(texts.resetText));
      expect(page, "reset button").toContain(escapeHtml(texts.resetButton));
      expect(page, "reset form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/reset")[^>]*>/);
      const afterForm = page.slice(page.indexOf('action="/setup/reset"'));
      expect(afterForm, "csrf field in the reset form").toContain(`name="csrf" value="${CSRF_TOKEN}"`);
    },
  );

  it("renderStartPage shows no reset form when no reset is needed", () => {
    const page = startPage("en", { resetNeeded: false });

    expect(page, "reset form").not.toContain('action="/setup/reset"');
    expect(page, "reset heading").not.toContain(escapeHtml(TEXTS.en.resetHeading));
  });
});

describe("renderStartPage settings form", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage renders the settings form with the defaults in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language);

      expect(page, "settings heading").toContain(escapeHtml(texts.settingsHeading));
      expect(page, "form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/settings")[^>]*>/);
      expect(page, "language label").toContain(escapeHtml(texts.notificationLanguageLabel));
      expect(page, "English option selected").toContain('<option value="en" selected>');
      expect(page, "German option").toContain('<option value="de">');
      expect(page, "time zone label").toContain(escapeHtml(texts.timeZoneLabel));
      expect(page, "UTC selected").toContain('<option value="UTC" selected>');
      expect(page, "another time zone").toContain('<option value="Europe/Berlin">');
      expect(inputTag(page, "quiet_hours"), "quiet hours checkbox").toMatch(/type="checkbox"/);
      expect(inputTag(page, "quiet_hours"), "quiet hours checkbox").toMatch(/value="on"/);
      expect(inputTag(page, "quiet_hours"), "quiet hours off").not.toMatch(/\bchecked\b/);
      expect(inputTag(page, "quiet_start"), "start field").toMatch(
        /type="time"[^>]*value="22:00"|value="22:00"[^>]*type="time"/,
      );
      expect(inputTag(page, "quiet_end"), "end field").toMatch(
        /type="time"[^>]*value="07:00"|value="07:00"[^>]*type="time"/,
      );
      expect(inputTag(page, "quiet_start"), "start field is not required").not.toMatch(/\brequired\b/);
      expect(inputTag(page, "update_notice"), "update notice on").toMatch(/\bchecked\b/);
      expect(page, "rules label").toContain(escapeHtml(texts.rulesLabel));
      expect(page, "update notice label").toContain(escapeHtml(texts.updateNoticeLabel));
      expect(page, "save button").toContain(escapeHtml(texts.saveSettingsButton));
    },
  );

  it.each(LANGUAGES.flatMap((language) => RULE_IDS.map((id) => ({ language, id }))))(
    "renderStartPage renders a checked checkbox and a label for the rule $id in $language",
    ({ language, id }) => {
      const page = startPage(language);

      expect(inputTag(page, `rule_${id}`), "checkbox").toMatch(
        /type="checkbox"[^>]*value="on"|value="on"[^>]*type="checkbox"/,
      );
      expect(inputTag(page, `rule_${id}`), "rule is on").toMatch(/\bchecked\b/);
      expect(page, "label").toContain(escapeHtml(TEXTS[language].ruleLabels[id]));
    },
  );

  it("renderStartPage renders the saved settings as selected and checked", () => {
    const settings: NotificationSettings = {
      language: "de",
      timeZone: "Europe/Berlin",
      quietHours: { start: "21:30", end: "06:15" },
      rules: { ...DEFAULT_SETTINGS.rules, dependabot_alert: false },
      updateNotice: false,
    };

    const page = startPage("en", { settings });

    expect(page, "German selected").toContain('<option value="de" selected>');
    expect(page, "English not selected").toContain('<option value="en">');
    expect(page, "zone selected").toContain('<option value="Europe/Berlin" selected>');
    expect(page, "UTC not selected").toContain('<option value="UTC">');
    expect(inputTag(page, "quiet_hours"), "quiet hours on").toMatch(/\bchecked\b/);
    expect(inputTag(page, "quiet_start"), "start").toContain('value="21:30"');
    expect(inputTag(page, "quiet_end"), "end").toContain('value="06:15"');
    expect(inputTag(page, "rule_dependabot_alert"), "switched-off rule").not.toMatch(/\bchecked\b/);
    expect(inputTag(page, "rule_code_scanning_alert"), "rule still on").toMatch(/\bchecked\b/);
    expect(inputTag(page, "update_notice"), "update notice off").not.toMatch(/\bchecked\b/);
  });

  it("renderStartPage puts the session-bound token into the settings form", () => {
    const page = startPage("en");

    const afterForm = page.slice(page.indexOf('action="/setup/settings"'));
    expect(afterForm, "csrf field").toContain(`name="csrf" value="${CSRF_TOKEN}"`);
  });
});
