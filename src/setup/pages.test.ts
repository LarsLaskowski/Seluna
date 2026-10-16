import { describe, expect, it } from "vitest";
import type { Language } from "./language";
import {
  escapeHtml,
  htmlResponse,
  renderLoginPage,
  renderNotConfiguredPage,
  renderStartPage,
  renderTelegramPage,
  STYLE,
} from "./pages";
import type { TelegramPageView } from "./pages";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";
import type { TelegramChat } from "../telegram";

const LANGUAGES: readonly Language[] = ["en", "de"];
const NOTICES: readonly Notice[] = ["wrong-secret", "locked", "form-expired", "unavailable"];
const CSRF_TOKEN = "T".repeat(43);

const TELEGRAM_LINK = "/setup/telegram";
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
  { page: "start", language, links: [TELEGRAM_LINK], html: () => renderStartPage(language, CSRF_TOKEN) },
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
