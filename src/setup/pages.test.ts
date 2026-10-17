import { describe, expect, it } from "vitest";
import type { Language } from "./language";
import {
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
import { TEXTS } from "./texts";
import type { Notice } from "./texts";
import type { TelegramChat } from "../telegram";

const LANGUAGES: readonly Language[] = ["en", "de"];
const NOTICES: readonly Notice[] = [
  "wrong-secret",
  "locked",
  "form-expired",
  "unavailable",
  "github-invalid-account",
  "github-return-invalid",
  "github-state-invalid",
  "github-code-rejected",
  "github-unavailable",
  "github-answer-invalid",
  "github-owner-mismatch",
  "github-store-failed",
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
  { page: "start", language, links: [TELEGRAM_LINK, GITHUB_LINK], html: () => renderStartPage(language, CSRF_TOKEN) },
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
      const page = renderStartPage(language, CSRF_TOKEN);

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
      const page = renderStartPage(language, CSRF_TOKEN);

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
      links: [GITHUB_LINK],
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
