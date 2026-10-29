import { describe, expect, it } from "vitest";
import type { AccountChoice } from "../github/manifest";
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
import type { Installation } from "../github/installations";
import type { InstallationEntry, InstallationsView, MessengerEntry, MessengersView, StatusView } from "./status";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";
import type { TelegramChat } from "../telegram";
import type { ChatPart, TokenState } from "./telegram-step";

const LANGUAGES: readonly Language[] = ["en", "de"];
const NOTICES: readonly Notice[] = [
  "wrong-secret",
  "locked",
  "form-expired",
  "unavailable",
  "migrations-missing",
  "telegram-token-missing",
  "telegram-token-malformed",
  "telegram-token-rejected",
  "telegram-token-invalid",
  "telegram-token-not-accepted",
  "telegram-token-unverified",
  "telegram-saved-token-rejected",
  "telegram-token-unreadable",
  "telegram-token-damaged",
  "telegram-token-not-saved",
  "telegram-conflict",
  "telegram-unavailable",
  "telegram-send-failed",
  "telegram-invalid-chat",
  "telegram-wrong-code",
  "telegram-code-expired",
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
  "messenger-invalid",
  "messenger-not-set-up",
  "messenger-worker-secrets",
];
const CSRF_TOKEN = "T".repeat(43);

const TELEGRAM_LINK = "/setup/telegram";
const GITHUB_LINK = "/setup/github";
const CHATS: readonly TelegramChat[] = [
  { id: 5_001_001, kind: "private", name: "Anna Beispiel", username: "anna_example" },
  { id: -4_001_001, kind: "group", name: "Seluna Testgroup", username: undefined },
];
const WORKER_SECRET_TOKEN: TokenState = { kind: "worker-secret", rejected: false };
const CHATS_VIEW: TelegramPageView = {
  kind: "step",
  token: WORKER_SECRET_TOKEN,
  chat: { kind: "chats", chats: CHATS, savedChatId: undefined },
};
const NO_CHATS_VIEW: TelegramPageView = {
  kind: "step",
  token: WORKER_SECRET_TOKEN,
  chat: { kind: "chats", chats: [], savedChatId: -1_001_234_567_890 },
};
const CODE_VIEW: TelegramPageView = {
  kind: "code",
  chatId: 5_001_001,
  proof: `v1.5001001.1700000600000.${"A".repeat(43)}`,
};

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

    const page = renderTelegramPage("en", CSRF_TOKEN, {
      kind: "step",
      token: WORKER_SECRET_TOKEN,
      chat: { kind: "chats", chats, savedChatId: undefined },
    });

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

    const page = renderTelegramPage("en", CSRF_TOKEN, {
      kind: "step",
      token: WORKER_SECRET_TOKEN,
      chat: { kind: "chats", chats, savedChatId: undefined },
    });

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

const TOKEN_FORM_ACTION = "/setup/telegram/token";
const REMOVE_FORM_ACTION = "/setup/telegram/token/remove";

function telegramStep(language: Language, token: TokenState, chat: ChatPart, notice?: Notice): string {
  return renderTelegramPage(language, CSRF_TOKEN, { kind: "step", token, chat }, notice);
}

/** The inside of the cards of the main column of `page`, in order. */
function cardsOf(page: string): string[] {
  return sectionsOf(mainOf(page)).map((section) => section.html);
}

/** The `action` of each form in `html`, in order. */
function formActions(html: string): string[] {
  return Array.from(html.matchAll(/<form\b([^>]*)>/g), (form) => attributesOf(form[1] ?? "").get("action") ?? "");
}

const HIDDEN_CHAT: ChatPart = { kind: "hidden", savedChatId: undefined };
const TOKEN_STATES: readonly { readonly name: string; readonly token: TokenState }[] = [
  { name: "missing", token: { kind: "missing" } },
  { name: "entry", token: { kind: "entry" } },
  { name: "saved", token: { kind: "saved", rejected: false } },
  { name: "saved and rejected", token: { kind: "saved", rejected: true } },
  { name: "damaged", token: { kind: "damaged" } },
  { name: "unreadable", token: { kind: "unreadable" } },
  { name: "worker-secret", token: { kind: "worker-secret", rejected: false } },
  { name: "worker-secret and rejected", token: { kind: "worker-secret", rejected: true } },
  { name: "worker-secret-malformed", token: { kind: "worker-secret-malformed" } },
];

describe("renderTelegramPage token card", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderTelegramPage renders the token card with a masked token field for a missing token in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = telegramStep(language, { kind: "missing" }, HIDDEN_CHAT);

      const [tokenCard = "", chatCard = "", ...rest] = cardsOf(page);
      expect(rest, "further cards").toEqual([]);
      expect(page, "heading").toContain(`<h1>${escapeHtml(texts.telegramHeading)}</h1>`);
      expect(tokenCard, "token card heading").toContain(`<h2>${escapeHtml(texts.telegramTokenHeading)}</h2>`);
      expect(tokenCard, "token intro").toContain(`<p>${escapeHtml(texts.telegramTokenIntro)}</p>`);
      expect(formActions(tokenCard), "forms of the token card").toEqual([TOKEN_FORM_ACTION]);
      expect(tokenCard, "form method").toMatch(/<form\b(?=[^>]*method="post")[^>]*>/);
      expect(tokenCard, "CSRF field").toMatch(hiddenInput("csrf", CSRF_TOKEN));
      expect(tokenCard, "label").toContain(`<label for="token">${escapeHtml(texts.telegramTokenLabel)}</label>`);
      const input = attributesOf(
        inputTag(tokenCard, "token")
          .replace(/^<input/, "")
          .replace(/>$/, ""),
      );
      expect(Object.fromEntries(input), "attributes of the token input").toEqual({
        id: "token",
        type: "password",
        name: "token",
        autocomplete: "off",
        spellcheck: "false",
        maxlength: "221",
        required: "",
      });
      expect(tokenCard, "button").toMatch(
        new RegExp(
          `<button type="submit" class="primary">${escapeRegExp(escapeHtml(texts.telegramTokenSaveButton))}</button>`,
        ),
      );
      expect(tokenCard, "disclosure").not.toContain("<details");
      expect(tokenCard, "remove form").not.toContain(REMOVE_FORM_ACTION);
      expect(chatCard, "chat card heading").toContain(`<h2>${escapeHtml(texts.telegramChatHeading)}</h2>`);
      expect(chatCard, "chat intro").toContain(`<p>${escapeHtml(texts.telegramIntro)}</p>`);
      expect(chatCard, "no saved chat").toContain(`<p>${escapeHtml(texts.telegramNoSavedChat)}</p>`);
      expect(chatCard, "forms of the chat card").not.toContain("<form");
      expect(chatCard, "search link").not.toContain("<a ");
    },
  );

  // The first five states carry a token form.
  it.each(TOKEN_STATES.slice(0, 5))(
    "renderTelegramPage never renders a value attribute on the token input: $name",
    ({ token }) => {
      const page = telegramStep("en", token, HIDDEN_CHAT);

      const input = inputTag(page, "token");
      expect(input, "token input").not.toBe("");
      expect(input, "value attribute").not.toMatch(/\svalue\s*=/);
    },
  );

  it("renderTelegramPage shows the notice and the token form without intro and chat card for the entry state", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "entry" }, { kind: "omitted" }, "telegram-token-invalid");

    const cards = cardsOf(page);
    expect(cards, "number of cards").toHaveLength(1);
    expect(cards[0], "notice").toContain(
      `<p class="notice error" role="alert">${escapeHtml(texts.notices["telegram-token-invalid"])}</p>`,
    );
    expect(cards[0], "token heading").toContain(`<h2>${escapeHtml(texts.telegramTokenHeading)}</h2>`);
    expect(formActions(cards[0] ?? ""), "forms").toEqual([TOKEN_FORM_ACTION]);
    expect(page, "token intro").not.toContain(escapeHtml(texts.telegramTokenIntro));
    expect(page, "chat heading").not.toContain(escapeHtml(texts.telegramChatHeading));
  });

  it("renderTelegramPage puts the notice parameter into the token card in place of the derived notice", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "unreadable" }, { kind: "omitted" }, "telegram-token-not-saved");

    const cards = cardsOf(page);
    expect(cards, "number of cards").toHaveLength(1);
    expect(cards[0], "given notice").toContain(escapeHtml(texts.notices["telegram-token-not-saved"]));
    expect(page, "derived notice").not.toContain(escapeHtml(texts.notices["telegram-token-unreadable"]));
    expect(page, "forms").not.toContain("<form");
  });

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderTelegramPage shows a saved token with Change token in a closed disclosure and Remove token in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = telegramStep(language, { kind: "saved", rejected: false }, HIDDEN_CHAT);

      const tokenCard = cardsOf(page)[0] ?? "";
      expect(tokenCard, "saved text").toContain(`<p>${escapeHtml(texts.telegramTokenSaved)}</p>`);
      expect(tokenCard, "closed disclosure").toMatch(/<details>/);
      expect(tokenCard, "open disclosure").not.toMatch(/<details\b[^>]*\bopen\b/);
      expect(tokenCard, "summary").toContain(`<summary>${escapeHtml(texts.telegramTokenChange)}</summary>`);
      expect(tokenCard, "token intro").not.toContain(escapeHtml(texts.telegramTokenIntro));
      expect(tokenCard, "rejected notice").not.toContain(escapeHtml(texts.notices["telegram-saved-token-rejected"]));
      const detailsStart = tokenCard.indexOf("<details");
      const detailsEnd = tokenCard.indexOf("</details>");
      expect(formActions(tokenCard.slice(detailsStart, detailsEnd)), "forms in the disclosure").toEqual([
        TOKEN_FORM_ACTION,
      ]);
      expect(tokenCard.slice(detailsStart, detailsEnd), "summary is the first element of the disclosure").toMatch(
        /^<details>\s*<summary>/,
      );
      expect(formActions(tokenCard.slice(detailsEnd)), "forms after the disclosure").toEqual([REMOVE_FORM_ACTION]);
      expect(tokenCard.slice(detailsEnd), "remove button").toMatch(
        new RegExp(
          `<button type="submit" class="secondary">${escapeRegExp(escapeHtml(texts.telegramTokenRemoveButton))}</button>`,
        ),
      );
      expect(tokenCard.slice(detailsEnd), "CSRF field of the remove form").toMatch(hiddenInput("csrf", CSRF_TOKEN));
    },
  );

  it("renderTelegramPage opens the disclosure and shows the rejected notice first for a rejected saved token", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "saved", rejected: true }, HIDDEN_CHAT);

    const tokenCard = cardsOf(page)[0] ?? "";
    const notice = escapeHtml(texts.notices["telegram-saved-token-rejected"]);
    expect(tokenCard, "rejected notice").toContain(`<p class="notice error" role="alert">${notice}</p>`);
    expect(tokenCard, "open disclosure").toMatch(/<details\b[^>]*\bopen\b/);
    expect(tokenCard.indexOf(notice), "notice comes before the saved text").toBeLessThan(
      tokenCard.indexOf(escapeHtml(texts.telegramTokenSaved)),
    );
    expect(formActions(tokenCard), "forms").toEqual([TOKEN_FORM_ACTION, REMOVE_FORM_ACTION]);
  });

  it("renderTelegramPage shows the damaged notice with the token form and Remove token and no disclosure", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "damaged" }, HIDDEN_CHAT);

    const tokenCard = cardsOf(page)[0] ?? "";
    expect(tokenCard, "damaged notice").toContain(
      `<p class="notice error" role="alert">${escapeHtml(texts.notices["telegram-token-damaged"])}</p>`,
    );
    expect(formActions(tokenCard), "forms").toEqual([TOKEN_FORM_ACTION, REMOVE_FORM_ACTION]);
    expect(tokenCard, "disclosure").not.toContain("<details");
    expect(tokenCard, "saved text").not.toContain(escapeHtml(texts.telegramTokenSaved));
  });

  it("renderTelegramPage shows only the unreadable notice for an unreadable token", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "unreadable" }, { kind: "omitted" });

    const cards = cardsOf(page);
    expect(cards, "number of cards").toHaveLength(1);
    expect(cards[0], "unreadable notice").toContain(
      `<p class="notice error" role="alert">${escapeHtml(texts.notices["telegram-token-unreadable"])}</p>`,
    );
    expect(page, "forms").not.toContain("<form");
    expect(page, "token intro").not.toContain(escapeHtml(texts.telegramTokenIntro));
  });

  it("renderTelegramPage shows the Worker secret note without forms and no rejected notice", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "worker-secret", rejected: false }, HIDDEN_CHAT);

    const tokenCard = cardsOf(page)[0] ?? "";
    expect(tokenCard, "note").toContain(`<p class="notice info">${escapeHtml(texts.telegramTokenWorkerSecret)}</p>`);
    expect(tokenCard, "forms").not.toContain("<form");
    expect(tokenCard, "rejected notice").not.toContain(escapeHtml(texts.notices["telegram-token-rejected"]));
  });

  it("renderTelegramPage shows the rejected notice before the Worker secret note for a rejected Worker secret", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "worker-secret", rejected: true }, HIDDEN_CHAT);

    const tokenCard = cardsOf(page)[0] ?? "";
    const notice = escapeHtml(texts.notices["telegram-token-rejected"]);
    const note = escapeHtml(texts.telegramTokenWorkerSecret);
    expect(tokenCard, "rejected notice").toContain(`<p class="notice error" role="alert">${notice}</p>`);
    expect(tokenCard, "note").toContain(`<p class="notice info">${note}</p>`);
    expect(tokenCard.indexOf(notice), "notice comes before the note").toBeLessThan(tokenCard.indexOf(note));
    expect(tokenCard, "forms").not.toContain("<form");
  });

  it("renderTelegramPage shows only the malformed notice for a malformed Worker secret", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "worker-secret-malformed" }, HIDDEN_CHAT);

    const tokenCard = cardsOf(page)[0] ?? "";
    expect(tokenCard, "malformed notice").toContain(
      `<p class="notice error" role="alert">${escapeHtml(texts.notices["telegram-token-malformed"])}</p>`,
    );
    expect(tokenCard, "forms").not.toContain("<form");
    expect(tokenCard, "note").not.toContain(escapeHtml(texts.telegramTokenWorkerSecret));
  });
});

describe("renderTelegramPage chat card", () => {
  it("renderTelegramPage shows only the chat id note in the chat card for the chat-id-secret part", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "saved", rejected: false }, { kind: "chat-id-secret" });

    const [tokenCard = "", chatCard = ""] = cardsOf(page);
    expect(tokenCard, "token card").toContain(escapeHtml(texts.telegramTokenSaved));
    expect(chatCard, "chat heading").toContain(`<h2>${escapeHtml(texts.telegramChatHeading)}</h2>`);
    expect(chatCard, "chat id note").toContain(`<p class="notice info">${escapeHtml(texts.telegramChatIdSecret)}</p>`);
    expect(chatCard, "intro").not.toContain(escapeHtml(texts.telegramIntro));
    expect(chatCard, "forms").not.toContain("<form");
    expect(chatCard, "links").not.toContain("<a ");
  });

  it("renderTelegramPage shows the intro and the saved chat and no search link for the hidden part", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "missing" }, { kind: "hidden", savedChatId: -1_001_234_567_890 });

    const chatCard = cardsOf(page)[1] ?? "";
    expect(chatCard, "intro").toContain(`<p>${escapeHtml(texts.telegramIntro)}</p>`);
    expect(chatCard, "saved chat").toContain(
      `<p>${escapeHtml(texts.telegramSavedChat)} <code>-1001234567890</code></p>`,
    );
    expect(chatCard, "search link").not.toContain(escapeHtml(texts.telegramSearchLink));
    expect(chatCard, "forms").not.toContain("<form");
  });

  it.each([
    { problem: "conflict", notice: "telegram-conflict" },
    { problem: "unavailable", notice: "telegram-unavailable" },
  ] as const)(
    "renderTelegramPage shows the $notice notice, the saved chat and the search link for the $problem problem",
    ({ problem, notice }) => {
      const texts = TEXTS.en;

      const page = telegramStep(
        "en",
        { kind: "worker-secret", rejected: false },
        { kind: "problem", problem, savedChatId: 5_001_001 },
      );

      const chatCard = cardsOf(page)[1] ?? "";
      expect(chatCard, "intro").toContain(`<p>${escapeHtml(texts.telegramIntro)}</p>`);
      expect(chatCard, "notice").toContain(
        `<p class="notice error" role="alert">${escapeHtml(texts.notices[notice])}</p>`,
      );
      expect(chatCard, "saved chat").toContain(`<code>5001001</code>`);
      expect(chatCard, "search link").toContain(
        `<a href="/setup/telegram">${escapeHtml(texts.telegramSearchLink)}</a>`,
      );
      expect(chatCard, "forms").not.toContain("<form");
    },
  );

  it("renderTelegramPage shows the saved chat, the search link and the chat form in the chat card for the chats part", () => {
    const texts = TEXTS.en;

    const page = telegramStep(
      "en",
      { kind: "saved", rejected: false },
      { kind: "chats", chats: CHATS, savedChatId: 5_001_001 },
    );

    const chatCard = cardsOf(page)[1] ?? "";
    expect(chatCard, "saved chat").toContain(`<code>5001001</code>`);
    expect(chatCard, "search link").toContain(`<a href="/setup/telegram">${escapeHtml(texts.telegramSearchLink)}</a>`);
    expect(formActions(chatCard), "forms").toEqual(["/setup/telegram"]);
    expect(chatCard, "chats intro").toContain(escapeHtml(texts.telegramChatsIntro));
    expect(cardsOf(page)[0], "chat form in the token card").not.toContain('name="chat"');
  });

  it("renderTelegramPage shows the token card before the chat card", () => {
    const texts = TEXTS.en;

    const page = telegramStep("en", { kind: "missing" }, HIDDEN_CHAT);

    expect(page.indexOf(`<h2>${escapeHtml(texts.telegramTokenHeading)}</h2>`), "token card first").toBeLessThan(
      page.indexOf(`<h2>${escapeHtml(texts.telegramChatHeading)}</h2>`),
    );
    expect(page.indexOf("<h1>"), "h1 first").toBeLessThan(page.indexOf("<h2>"));
  });
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

describe("renderGitHubPage", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderGitHubPage reset-needed view shows the reset needed notice and no link in its card in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = renderGitHubPage(language, CSRF_TOKEN, { kind: "reset-needed" });

      const sections = sectionsOf(mainOf(page));
      expect(sections, "number of cards").toHaveLength(1);
      expect(sections[0]?.html.trim(), "content of the card").toBe(
        `<p class="notice error">${escapeHtml(texts.githubResetNeeded)}</p>`,
      );
      expect(page, "text of the removed link").not.toMatch(/Open the start page|Startseite öffnen/);
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

describe("the review page lists", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "the review page lists the eight permissions and nine events in $language",
    ({ language }) => {
      const page = renderGitHubReviewPage(
        language,
        { type: "personal", account: "octocat" },
        "seluna-octocat",
        REVIEW_ACTION,
        "{}",
      );

      const text = plainText(page);

      expect(text, "permissions").toContain(
        "Actions, Contents, Issues, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts, Metadata",
      );
      expect(text, "events").toContain(
        "Pull request, Workflow run, Dependabot alert, Code scanning alert, Secret scanning alert, Issues, Issue comment, Fork, Star",
      );
    },
  );
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

function entryOf(changes: Partial<MessengerEntry> = {}): MessengerEntry {
  return {
    id: "telegram",
    name: "Telegram",
    setupPath: "/setup/telegram",
    configured: true,
    active: true,
    removable: false,
    ...changes,
  };
}

/** The messengers of a status view: `entries` in order, the active one named by its flag. */
function messengersOf(entries: readonly MessengerEntry[]): MessengersView {
  const active = entries.find((entry) => entry.active);
  if (active === undefined) {
    throw new TypeError("No entry is active");
  }
  return { entries, active };
}

function statusViewWith(changes: Partial<StatusView> = {}): StatusView {
  return {
    version: "1.2.3-test",
    botToken: "worker-secret",
    chat: { kind: "saved", chatId: -1_001_234_567_890 },
    app: { kind: "saved", appId: 12_345, slug: "seluna-demo" },
    lastDelivery: DELIVERY_AT_UTC,
    resetNeeded: false,
    settings: DEFAULT_SETTINGS,
    installations: { kind: "hidden" },
    owner: { kind: "hidden" },
    appAccess: { kind: "hidden" },
    messengers: messengersOf([entryOf()]),
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

/** A copy of `texts` sorted alphabetically. */
function sorted(texts: readonly string[]): string[] {
  const copy = [...texts];
  copy.sort((left, right) => left.localeCompare(right));
  return copy;
}

const SLUG_LINK = "https://github.com/apps/seluna-demo";
const ORGANIZATION: AccountChoice = { type: "organization", account: "octo-org" };

/** The item of the step navigation a page marks as current. */
type StepItem = "start" | "telegram" | "github";

const STEP_PATHS: Readonly<Record<StepItem, string>> = {
  start: "/setup",
  telegram: TELEGRAM_LINK,
  github: GITHUB_LINK,
};
const STEP_ORDER: readonly StepItem[] = ["start", "telegram", "github"];

/** The label of a step navigation item in `language`. */
function stepLabel(language: Language, item: StepItem): string {
  const texts = TEXTS[language];
  switch (item) {
    case "start":
      return texts.startPageLink;
    case "telegram":
      return texts.telegramHeading;
    case "github":
      return texts.githubHeading;
  }
}

/** The step navigation a page with `current` as its current item has, as the plan's *Approach* fixes it. */
function expectedStepNavigation(language: Language, current: StepItem): string {
  const items = STEP_ORDER.map((item) => {
    const label = escapeHtml(stepLabel(language, item));
    return item === current
      ? `<span aria-current="page">${label}</span>`
      : `<a href="${STEP_PATHS[item]}">${label}</a>`;
  });
  return `<nav class="steps" aria-label="${escapeHtml(TEXTS[language].stepsLabel)}">${items.join(" | ")}</nav>`;
}

/** The step navigation element of `html`, or an empty text. */
function stepNavigationOf(html: string): string {
  return /<nav class="steps"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
}

/** The navigation links of the page's current item: the other two items. */
function navigationLinks(current: StepItem | undefined): readonly string[] {
  return current === undefined ? [] : STEP_ORDER.filter((item) => item !== current).map((item) => STEP_PATHS[item]);
}

interface PageCase {
  readonly page: string;
  readonly language: Language;
  /** The current item of the step navigation, undefined for the pages without the navigation. */
  readonly current: StepItem | undefined;
  /** The internal `href` values besides the two language links and the navigation links. */
  readonly links: readonly string[];
  /** The external addresses in `src`, `href` and `action`. */
  readonly external: readonly string[];
  readonly html: () => string;
}

/** The current item of the page named `page` in `ALL_PAGES`, by its name's first word. */
function currentOf(page: string): StepItem | undefined {
  const first = page.split(" ")[0];
  return first === "start" || first === "telegram" || first === "github" ? first : undefined;
}

/** Every view of every setup page in each language. */
const ALL_PAGES: readonly PageCase[] = LANGUAGES.flatMap((language): readonly PageCase[] => {
  const entry = (
    page: string,
    links: readonly string[],
    external: readonly string[],
    html: () => string,
  ): PageCase => ({ page, language, current: currentOf(page), links, external, html });
  const start = (changes: Partial<StatusView>, notice?: Notice): (() => string) => {
    return () => startPage(language, changes, notice);
  };
  const telegram = (view: TelegramPageView, notice?: Notice): (() => string) => {
    return () => renderTelegramPage(language, CSRF_TOKEN, view, notice);
  };
  const github = (view: GitHubPageView, notice?: Notice): (() => string) => {
    return () => renderGitHubPage(language, CSRF_TOKEN, view, notice);
  };
  const review = (choice: AccountChoice): (() => string) => {
    return () => renderGitHubReviewPage(language, choice, "seluna-demo", REVIEW_ACTION, '{"name":"seluna-demo"}');
  };
  const stepLinks = [TELEGRAM_LINK, GITHUB_LINK];
  // The status view also links the setup page of the messenger in the Messengers card.
  const statusLinks = [TELEGRAM_LINK, GITHUB_LINK, TELEGRAM_LINK];
  return [
    entry("login", [], [], () => renderLoginPage(language, CSRF_TOKEN)),
    entry("login with a notice", [], [], () => renderLoginPage(language, CSRF_TOKEN, "wrong-secret")),
    entry("not-configured", [], [], () => renderNotConfiguredPage(language)),
    entry(
      "start status with a saved app, installations and reset needed",
      statusLinks,
      [SLUG_LINK],
      start({
        app: { kind: "saved", appId: 12_345, slug: "seluna-demo" },
        installations: listed([installationOf({ kind: "login", login: "octocat", type: "User" })]),
        resetNeeded: true,
      }),
    ),
    entry(
      "start status with Worker secrets and installations unavailable",
      statusLinks,
      [],
      start({ app: { kind: "worker-secrets" }, installations: { kind: "unavailable" } }),
    ),
    entry(
      "start status without an app",
      statusLinks,
      [],
      start({ app: { kind: "none" }, chat: { kind: "none" }, lastDelivery: undefined }),
    ),
    entry(
      "start status with a notice",
      statusLinks,
      [],
      start({ app: { kind: "saved", appId: 12_345, slug: undefined } }, "form-expired"),
    ),
    entry("start notice-only", stepLinks, [], () =>
      renderStartPage(language, CSRF_TOKEN, { kind: "notice-only" }, "unavailable"),
    ),
    entry(
      "telegram chat id secret",
      [],
      [],
      telegram({ kind: "step", token: WORKER_SECRET_TOKEN, chat: { kind: "chat-id-secret" } }),
    ),
    entry("telegram notice-only", [TELEGRAM_LINK], [], telegram({ kind: "notice-only" }, "telegram-send-failed")),
    entry("telegram code", [TELEGRAM_LINK], [], telegram(CODE_VIEW)),
    entry("telegram code with a notice", [TELEGRAM_LINK], [], telegram(CODE_VIEW, "telegram-wrong-code")),
    entry(
      "telegram token missing without a saved chat",
      [],
      [],
      telegram({ kind: "step", token: { kind: "missing" }, chat: { kind: "hidden", savedChatId: undefined } }),
    ),
    entry(
      "telegram token missing with a saved chat",
      [],
      [],
      telegram({ kind: "step", token: { kind: "missing" }, chat: { kind: "hidden", savedChatId: -1_001_234_567_890 } }),
    ),
    entry(
      "telegram token entry with a notice",
      [],
      [],
      telegram({ kind: "step", token: { kind: "entry" }, chat: { kind: "omitted" } }, "telegram-token-invalid"),
    ),
    entry(
      "telegram token saved with chats",
      [TELEGRAM_LINK],
      [],
      telegram({
        kind: "step",
        token: { kind: "saved", rejected: false },
        chat: { kind: "chats", chats: CHATS, savedChatId: 5_001_001 },
      }),
    ),
    entry(
      "telegram token saved and rejected",
      [],
      [],
      telegram({
        kind: "step",
        token: { kind: "saved", rejected: true },
        chat: { kind: "hidden", savedChatId: undefined },
      }),
    ),
    entry(
      "telegram token saved with the chat id secret",
      [],
      [],
      telegram({ kind: "step", token: { kind: "saved", rejected: false }, chat: { kind: "chat-id-secret" } }),
    ),
    entry(
      "telegram token damaged",
      [],
      [],
      telegram({ kind: "step", token: { kind: "damaged" }, chat: { kind: "hidden", savedChatId: undefined } }),
    ),
    entry(
      "telegram token unreadable with a notice",
      [],
      [],
      telegram({ kind: "step", token: { kind: "unreadable" }, chat: { kind: "omitted" } }, "telegram-token-not-saved"),
    ),
    entry(
      "telegram token from the Worker secret and rejected",
      [],
      [],
      telegram({
        kind: "step",
        token: { kind: "worker-secret", rejected: true },
        chat: { kind: "hidden", savedChatId: undefined },
      }),
    ),
    entry(
      "telegram token from a malformed Worker secret",
      [],
      [],
      telegram({
        kind: "step",
        token: { kind: "worker-secret-malformed" },
        chat: { kind: "hidden", savedChatId: undefined },
      }),
    ),
    entry(
      "telegram chat conflict",
      [TELEGRAM_LINK],
      [],
      telegram({
        kind: "step",
        token: WORKER_SECRET_TOKEN,
        chat: { kind: "problem", problem: "conflict", savedChatId: -1_001_234_567_890 },
      }),
    ),
    entry(
      "telegram chat unavailable",
      [TELEGRAM_LINK],
      [],
      telegram({
        kind: "step",
        token: WORKER_SECRET_TOKEN,
        chat: { kind: "problem", problem: "unavailable", savedChatId: undefined },
      }),
    ),
    entry("telegram chats", [TELEGRAM_LINK], [], telegram(CHATS_VIEW)),
    entry("telegram no chats", [TELEGRAM_LINK], [], telegram(NO_CHATS_VIEW)),
    entry("github worker-secrets", [], [], github({ kind: "worker-secrets" })),
    entry("github partial-worker-secrets", [], [], github({ kind: "partial-worker-secrets" })),
    entry("github reset-needed", [], [], github({ kind: "reset-needed" })),
    entry("github notice-only", [GITHUB_LINK], [], github({ kind: "notice-only" }, "github-state-invalid")),
    entry("github form", [], [], github({ kind: "form", savedAppId: undefined })),
    entry("github form with a saved app", [], [], github({ kind: "form", savedAppId: 12_345 })),
    entry(
      "github form with a notice",
      [],
      [],
      github({ kind: "form", savedAppId: undefined }, "github-invalid-account"),
    ),
    entry("github created", [], [INSTALL_LINK], github({ kind: "created", slug: "octoapp" })),
    entry("github created without a slug", [], [], github({ kind: "created", slug: undefined })),
    entry("github review of a personal account", [], [REVIEW_ACTION], review({ type: "personal", account: "octocat" })),
    entry("github review of an organization", [], [REVIEW_ACTION], review(ORGANIZATION)),
    entry("github finish", [], [], () => renderGitHubFinishPage(language, "abc123", GITHUB_STATE)),
    entry("github finish with a notice", [], [], () =>
      renderGitHubFinishPage(language, "abc123", GITHUB_STATE, "github-unavailable"),
    ),
  ];
});

/** `html` without the whitespace between two tags. */
function compact(html: string): string {
  return html.replaceAll(/>\s+</g, "><").trim();
}

/** The text of `html`: tags replaced by a space, whitespace collapsed, character references left as they are. */
function plainText(html: string): string {
  return html
    .replaceAll(/<[^<>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * The text between `<body>` and `</body>` without the brand paragraph and the step navigation (new markup) and
 * without the content of the time zone select (runtime-dependent).
 */
function bodyText(html: string): string {
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  return plainText(
    body
      .replace(/<p class="brand">[\s\S]*?<\/p>/, "")
      .replace(/<nav class="steps"[\s\S]*?<\/nav>/, "")
      .replace(/(<select id="time_zone"[^>]*>)[\s\S]*?(<\/select>)/, "$1$2"),
  );
}

const SIGNATURE_ATTRIBUTES = [
  "type",
  "name",
  "value",
  "id",
  "for",
  "required",
  "pattern",
  "maxlength",
  "inputmode",
  "autocomplete",
  "checked",
  "selected",
] as const;

/** The attributes of a start tag's attribute text, a bare attribute with an empty value. */
function attributesOf(attributeText: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of attributeText.matchAll(/\s([^\s="]+)(?:="([^"]*)")?/g)) {
    attributes.set(match[1] ?? "", match[2] ?? "");
  }
  return attributes;
}

/** `name` and the signature attributes of a start tag, in a fixed order; `class` is left out. */
function tagSignature(name: string, attributeText: string): string {
  const attributes = attributesOf(attributeText);
  const shown = SIGNATURE_ATTRIBUTES.filter((attribute) => attributes.has(attribute)).map(
    (attribute) => `${attribute}=${attributes.get(attribute) ?? ""}`,
  );
  return [name, ...shown].join(" ");
}

/** Per form its method and action, then its labels, controls and buttons in order; the time zone options reduced to the selected one. */
function formsSignature(html: string): string {
  return Array.from(html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g), (form) => {
    const content = (form[2] ?? "").replace(/<select id="time_zone"[\s\S]*?<\/select>/, (block) =>
      block
        .split("\n")
        .filter((line) => !line.startsWith("<option") || line.includes(" selected"))
        .join("\n"),
    );
    const tags = Array.from(content.matchAll(/<(label|input|select|option|button|textarea)\b([^>]*)>/g), (tag) =>
      tagSignature(tag[1] ?? "", tag[2] ?? ""),
    );
    const attributes = attributesOf(form[1] ?? "");
    return [`form method=${attributes.get("method") ?? ""} action=${attributes.get("action") ?? ""}`, ...tags].join(
      "\n",
    );
  }).join("\n\n");
}

/** The inside of the element `main`, or an empty text. */
function mainOf(html: string): string {
  return /<main>([\s\S]*)<\/main>/.exec(html)?.[1] ?? "";
}

interface Section {
  readonly kind: string;
  readonly html: string;
}

/** The `section` elements (class `card` or `actions`) of `html` in order; sections do not nest. */
function sectionsOf(html: string): Section[] {
  return Array.from(html.matchAll(/<section class="(card|actions)">([\s\S]*?)<\/section>/g), (match) => ({
    kind: match[1] ?? "",
    html: match[2] ?? "",
  }));
}

/** The inside of the section of `html` that contains `needle`, or an empty text. */
function sectionWith(html: string, needle: string): string {
  return sectionsOf(mainOf(html)).find((section) => section.html.includes(needle))?.html ?? "";
}

/** The `class` values of the buttons in `html`, in order (an empty text for a button without class). */
function buttonClasses(html: string): string[] {
  return Array.from(html.matchAll(/<button\b([^>]*)>/g), (button) => attributesOf(button[1] ?? "").get("class") ?? "");
}

describe("NOTICES", () => {
  it("NOTICES lists every value of the notices table", () => {
    expect(sorted(NOTICES), "notices").toEqual(sorted(Object.keys(TEXTS.en.notices)));
  });
});

describe("the pages", () => {
  it.each(ALL_PAGES)(
    "the $page page in $language has exactly one style element with STYLE as its content",
    ({ html }) => {
      const page = html();

      expect(page.match(/<style/gi)?.length, "number of style elements").toBe(1);
      expect(page, "the style element").toContain(`<style>${STYLE}</style>`);
    },
  );

  it.each(ALL_PAGES)(
    "the $page page in $language has no style attribute, script, link, img, iframe or xlink:href",
    ({ html }) => {
      const page = html();

      expect(page.toLowerCase(), "page text").not.toMatch(/<(?:script|link|img|iframe)\b/);
      expect(page, "style attribute").not.toMatch(/<[a-z][^>]*\sstyle\s*=/i);
      expect(page.toLowerCase(), "xlink:href").not.toContain("xlink:href");
    },
  );

  it.each(ALL_PAGES)(
    "the $page page in $language has exactly its own external addresses in src, href and action",
    ({ html, external }) => {
      const page = html();

      expect(
        [...attributeValues(page, "src"), ...attributeValues(page, "href"), ...attributeValues(page, "action")].filter(
          (value) => /^(?:https?:)?\/\//i.test(value),
        ),
        "external addresses in src, href and action",
      ).toEqual(external);
    },
  );

  it.each(ALL_PAGES)("the $page page in $language sets html lang to $language", ({ html, language }) => {
    const page = html();

    expect(page, "page").toContain(`<html lang="${language}">`);
  });

  it.each(ALL_PAGES)(
    "the $page page in $language links to /setup?lang=en, /setup?lang=de and its own links only",
    ({ html, links, external, current }) => {
      const page = html();

      const hrefs = attributeValues(page, "href").filter((value) => !external.includes(value));
      expect(sorted(hrefs), "href values").toEqual(
        sorted([...links, ...navigationLinks(current), "/setup?lang=de", "/setup?lang=en"]),
      );
    },
  );

  it.each(ALL_PAGES)("the $page page in $language keeps the viewport meta element", ({ html }) => {
    const page = html();

    expect(
      page.match(/<meta name="viewport" content="width=device-width, initial-scale=1">/g)?.length,
      "viewport",
    ).toBe(1);
  });
});

describe("the pages before this change", () => {
  it.each(ALL_PAGES)("the body text of the $page page in $language is unchanged", ({ html }) => {
    expect(bodyText(html())).toMatchSnapshot();
  });

  it.each(ALL_PAGES)("the forms of the $page page in $language are unchanged", ({ html }) => {
    expect(formsSignature(html())).toMatchSnapshot();
  });
});

describe("the page frame", () => {
  it.each(ALL_PAGES)(
    "the $page page in $language names the step navigation and the language navigation",
    ({ html, language, current }) => {
      const texts = TEXTS[language];
      const page = html();

      const body = compact(/<body>([\s\S]*)<\/body>/.exec(page)?.[1] ?? "");
      const header =
        `<header class="site"><p class="brand">${escapeHtml(texts.pageTitle)}</p>` +
        (current === undefined ? "" : expectedStepNavigation(language, current)) +
        `<nav aria-label="${escapeHtml(texts.languageLabel)}">${escapeHtml(texts.languageLabel)}: ` +
        `<a href="/setup?lang=en">English</a> | <a href="/setup?lang=de">Deutsch</a></nav></header><main>`;
      expect(body.startsWith(header), "the body starts with the header and the main element").toBe(true);
      expect(body.endsWith("</main>"), "the body ends with the main element").toBe(true);
    },
  );

  it.each(ALL_PAGES)("the $page page in $language has one main element holding its only h1", ({ html }) => {
    const page = html();

    expect(page.match(/<main[\s>]/g)?.length, "number of main elements").toBe(1);
    expect(page.match(/<h1[\s>]/g)?.length, "number of h1 elements").toBe(1);
    expect(mainOf(page).match(/<h1[\s>]/g)?.length, "number of h1 elements in main").toBe(1);
    expect(page.slice(0, page.indexOf("<main")), "headings before main").not.toMatch(/<h[1-6][\s>]/);
  });
});

describe("the step navigation", () => {
  const WITH_STEPS = ALL_PAGES.filter(({ current }) => current !== undefined);
  const STEP_PAGES = ALL_PAGES.filter(({ current }) => current === "telegram" || current === "github");
  const START_PAGES = ALL_PAGES.filter(({ current }) => current === "start");
  const WITHOUT_STEPS = ALL_PAGES.filter(({ current }) => current === undefined);

  it("the page list holds pages with and without the step navigation in both languages", () => {
    expect(STEP_PAGES.length, "step pages").toBeGreaterThan(0);
    expect(START_PAGES.length, "start pages").toBeGreaterThan(0);
    expect(
      WITHOUT_STEPS.map(({ page }) => page),
      "pages without the navigation",
    ).toEqual(["login", "login with a notice", "not-configured", "login", "login with a notice", "not-configured"]);
  });

  it.each(STEP_PAGES)(
    "the $page page in $language has exactly one link to /setup, the Start page item of the step navigation",
    ({ html, language }) => {
      const page = html();

      expect(
        attributeValues(page, "href").filter((href) => href === "/setup"),
        "links to /setup",
      ).toHaveLength(1);
      expect(
        /<a href="\/setup">([^<]*)<\/a>/.exec(stepNavigationOf(page))?.[1],
        "label of the link to /setup in the step navigation",
      ).toBe(escapeHtml(TEXTS[language].startPageLink));
    },
  );

  it.each(STEP_PAGES)(
    "the $page page in $language shows the step navigation with its step as the current item",
    ({ html, language, current }) => {
      const page = html();

      expect(current, "current item of a step page").toBeDefined();
      expect(stepNavigationOf(page), "step navigation").toBe(expectedStepNavigation(language, current ?? "start"));
    },
  );

  it.each(START_PAGES)(
    "the $page page in $language shows the step navigation with the start page as the current item and no link to /setup",
    ({ html, language }) => {
      const page = html();

      expect(stepNavigationOf(page), "step navigation").toBe(expectedStepNavigation(language, "start"));
      expect(page, "link to /setup").not.toContain('href="/setup"');
    },
  );

  /** The page without its style element, whose CSS names `aria-current` and `.steps`. */
  function markupOf(html: string): string {
    return html.replace(`<style>${STYLE}</style>`, "");
  }

  it.each(WITH_STEPS)(
    "the $page page in $language has exactly one aria-current, on a span inside the step navigation, items in order",
    ({ html, language, current }) => {
      const page = html();

      const navigation = stepNavigationOf(page);
      expect(markupOf(page).match(/aria-current/g), "aria-current attributes in the page").toHaveLength(1);
      expect(navigation.match(/<span aria-current="page">/g), "current spans in the navigation").toHaveLength(1);
      expect(
        Array.from(navigation.matchAll(/<(?:a|span)\b[^>]*>([^<]*)<\/(?:a|span)>/g), (match) => match[1]),
        "item labels in order",
      ).toEqual(STEP_ORDER.map((item) => escapeHtml(stepLabel(language, item))));
      expect(navigation, "the current item as marked text, not a link").toContain(
        `<span aria-current="page">${escapeHtml(stepLabel(language, current ?? "start"))}</span>`,
      );
    },
  );

  it.each(WITH_STEPS)(
    "the step navigation of the $page page in $language links only to /setup, /setup/telegram and /setup/github",
    ({ html }) => {
      const hrefs = attributeValues(stepNavigationOf(html()), "href");

      expect(hrefs, "step navigation hrefs").toHaveLength(2);
      for (const href of hrefs) {
        expect(["/setup", "/setup/telegram", "/setup/github"], `step navigation href ${href}`).toContain(href);
        expect(href, "query or fragment").not.toMatch(/[?#]/);
      }
    },
  );

  it.each(WITHOUT_STEPS)("the $page page in $language has no step navigation and no aria-current", ({ html }) => {
    const page = markupOf(html());

    expect(page, "class steps anywhere in the markup").not.toContain('class="steps"');
    expect(page, "aria-current anywhere in the markup").not.toContain("aria-current");
  });

  it.each(ALL_PAGES)(
    "the $page page in $language names the language navigation by the language label",
    ({ html, language }) => {
      const label = escapeHtml(TEXTS[language].languageLabel);

      expect(html(), "language navigation").toContain(
        `<nav aria-label="${label}">${label}: <a href="/setup?lang=en">English</a> | <a href="/setup?lang=de">Deutsch</a></nav>`,
      );
    },
  );
});

describe("the buttons", () => {
  /** The buttons of `html` as pairs of the action of their form and their `class`. */
  function buttonsByForm(html: string): { action: string; classes: string[] }[] {
    return Array.from(html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g), (form) => ({
      action: attributesOf(form[1] ?? "").get("action") ?? "",
      classes: buttonClasses(form[2] ?? ""),
    }));
  }

  function expectedKind(action: string): string {
    switch (action) {
      case "/setup/logout":
      case "/setup/telegram/token/remove":
      case "/setup/channel/remove":
        return "secondary";
      case "/setup/reset":
        return "danger";
      default:
        return "primary";
    }
  }

  it.each(ALL_PAGES)(
    "every button of the $page page in $language has its kind: sign-out and remove token secondary, reset danger, every other primary",
    ({ html }) => {
      const page = html();

      const forms = buttonsByForm(page);
      expect(
        forms.flatMap((form) => form.classes),
        "all buttons are inside a form",
      ).toHaveLength(buttonClasses(page).length);
      for (const form of forms) {
        expect(form.classes, `button classes of the form to ${form.action}`).toEqual(
          form.classes.map(() => expectedKind(form.action)),
        );
        expect(form.classes.length, `buttons of the form to ${form.action}`).toBe(1);
      }
    },
  );

  it("the pages together show a primary, a secondary and a danger button", () => {
    const kinds = new Set(ALL_PAGES.flatMap(({ html }) => buttonClasses(html())));

    expect(sorted([...kinds]), "button kinds").toEqual(["danger", "primary", "secondary"]);
  });
});

describe("the notice kinds", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "every notice is shown in the error style in $language",
    ({ language }) => {
      for (const notice of NOTICES) {
        const text = escapeHtml(TEXTS[language].notices[notice]);

        const login = renderLoginPage(language, CSRF_TOKEN, notice);
        const step = renderGitHubPage(language, CSRF_TOKEN, { kind: "notice-only" }, notice);

        expect(login, `${notice} on the login page`).toContain(`<p class="notice error" role="alert">${text}</p>`);
        expect(step, `${notice} on a step page`).toContain(`<p class="notice error" role="alert">${text}</p>`);
      }
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "the chat id secret, Worker secrets and app saved texts are shown in the info style in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const chatIdSecret = renderTelegramPage(language, CSRF_TOKEN, {
        kind: "step",
        token: WORKER_SECRET_TOKEN,
        chat: { kind: "chat-id-secret" },
      });
      const workerToken = renderTelegramPage(language, CSRF_TOKEN, {
        kind: "step",
        token: WORKER_SECRET_TOKEN,
        chat: { kind: "hidden", savedChatId: undefined },
      });
      const workerSecrets = renderGitHubPage(language, CSRF_TOKEN, { kind: "worker-secrets" });
      const created = renderGitHubPage(language, CSRF_TOKEN, { kind: "created", slug: "octoapp" });

      expect(chatIdSecret, "chat id secret").toContain(
        `<p class="notice info">${escapeHtml(texts.telegramChatIdSecret)}</p>`,
      );
      expect(workerToken, "bot token Worker secret").toContain(
        `<p class="notice info">${escapeHtml(texts.telegramTokenWorkerSecret)}</p>`,
      );
      expect(workerSecrets, "Worker secrets").toContain(
        `<p class="notice info">${escapeHtml(texts.githubWorkerSecrets)}</p>`,
      );
      expect(created, "app saved").toContain(`<p class="notice info">${escapeHtml(texts.githubCreated)}</p>`);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "the partial Worker secrets and reset needed texts are shown in the error style in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const partial = renderGitHubPage(language, CSRF_TOKEN, { kind: "partial-worker-secrets" });
      const resetNeeded = renderGitHubPage(language, CSRF_TOKEN, { kind: "reset-needed" });

      expect(partial, "partial Worker secrets").toContain(
        `<p class="notice error">${escapeHtml(texts.githubPartialWorkerSecrets)}</p>`,
      );
      expect(resetNeeded, "reset needed").toContain(
        `<p class="notice error">${escapeHtml(texts.githubResetNeeded)}</p>`,
      );
    },
  );
});

describe("renderStartPage sections", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage status view shows the heading block, status, reset, steps, settings and sign-out in this order, each in its own section in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language, { resetNeeded: true, app: { kind: "unreadable" } }, "settings-invalid");

      const main = mainOf(page);
      const sections = sectionsOf(main);
      const headingBlock = main.slice(0, main.indexOf("<section"));
      expect(compact(headingBlock), "heading block").toBe(
        `<h1>${escapeHtml(texts.startHeading)}</h1><p>${escapeHtml(texts.startBody)}</p>` +
          `<p class="notice error" role="alert">${escapeHtml(texts.notices["settings-invalid"])}</p>`,
      );
      expect(
        sections.map((section) => section.kind),
        "section kinds",
      ).toEqual(["card", "card", "card", "card", "card", "actions"]);
      expect(compact(sections[0]?.html ?? "").startsWith(`<h2>${escapeHtml(texts.statusHeading)}</h2>`), "status").toBe(
        true,
      );
      expect(compact(sections[1]?.html ?? "").startsWith(`<h2>${escapeHtml(texts.resetHeading)}</h2>`), "reset").toBe(
        true,
      );
      expect(sections[1]?.html, "reset form").toContain('action="/setup/reset"');
      expect(buttonClasses(sections[1]?.html ?? ""), "reset button").toEqual(["danger"]);
      expect(
        compact(sections[2]?.html ?? "").startsWith(`<h2>${escapeHtml(texts.messengersHeading)}</h2>`),
        "messengers after the reset section",
      ).toBe(true);
      expect(sections[3]?.html, "Telegram link").toContain('<a href="/setup/telegram">');
      expect(sections[3]?.html, "GitHub link").toContain('<a href="/setup/github">');
      expect(
        compact(sections[4]?.html ?? "").startsWith(`<h2>${escapeHtml(texts.settingsHeading)}</h2>`),
        "settings",
      ).toBe(true);
      expect(sections[4]?.html, "settings form").toContain('action="/setup/settings"');
      expect(buttonClasses(sections[4]?.html ?? ""), "settings button").toEqual(["primary"]);
      expect(sections[5]?.html, "sign-out form").toContain('action="/setup/logout"');
      expect(buttonClasses(sections[5]?.html ?? ""), "sign-out button").toEqual(["secondary"]);
      expect(
        main
          .slice(main.indexOf("<section"))
          .replaceAll(/<section class="(?:card|actions)">[\s\S]*?<\/section>/g, "")
          .trim(),
        "main outside the sections",
      ).toBe("");
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage without a reset shows no reset section and no empty section in $language",
    ({ language }) => {
      const page = startPage(language, { resetNeeded: false });

      const sections = sectionsOf(mainOf(page));
      expect(
        sections.map((section) => section.kind),
        "section kinds",
      ).toEqual(["card", "card", "card", "card", "actions"]);
      expect(
        compact(sections[1]?.html ?? "").startsWith(`<h2>${escapeHtml(TEXTS[language].messengersHeading)}</h2>`),
        "messengers follow the status section",
      ).toBe(true);
      expect(page, "reset form").not.toContain('action="/setup/reset"');
      expect(
        sections.filter((section) => plainText(section.html) === ""),
        "empty sections",
      ).toEqual([]);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage without a notice shows no notice element in $language",
    ({ language }) => {
      const status = startPage(language);
      const noticeOnly = renderStartPage(language, CSRF_TOKEN, { kind: "notice-only" });

      expect(status, "status view").not.toMatch(/class="notice|role="alert"/);
      expect(noticeOnly, "notice-only view").not.toMatch(/class="notice|role="alert"/);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage notice-only view shows the notice, the steps section and the sign-out section in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = renderStartPage(language, CSRF_TOKEN, { kind: "notice-only" }, "unavailable");

      const main = mainOf(page);
      const sections = sectionsOf(main);
      expect(compact(main.slice(0, main.indexOf("<section"))), "heading block").toBe(
        `<h1>${escapeHtml(texts.startHeading)}</h1><p>${escapeHtml(texts.startBody)}</p>` +
          `<p class="notice error" role="alert">${escapeHtml(texts.notices.unavailable)}</p>`,
      );
      expect(
        sections.map((section) => section.kind),
        "section kinds",
      ).toEqual(["card", "actions"]);
      expect(sections[0]?.html, "Telegram link").toContain('<a href="/setup/telegram">');
      expect(sections[0]?.html, "GitHub link").toContain('<a href="/setup/github">');
      expect(sections[1]?.html, "sign-out form").toContain('action="/setup/logout"');
      expect(buttonClasses(sections[1]?.html ?? ""), "sign-out button").toEqual(["secondary"]);
      expect(page, "settings form").not.toContain('action="/setup/settings"');
    },
  );
});

/** The `fieldset` elements with class `group` of `html`: the inside of the legend and the rest. */
function fieldsetsOf(html: string): { legend: string; content: string }[] {
  return Array.from(
    html.matchAll(/<fieldset class="group">\s*<legend>([\s\S]*?)<\/legend>([\s\S]*?)<\/fieldset>/g),
    (match) => ({ legend: match[1] ?? "", content: match[2] ?? "" }),
  );
}

describe("renderStartPage setting groups", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage puts quiet hours, start and end in one fieldset whose legend holds the quiet hours switch in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language);

      expect(page.match(/<fieldset/g)?.length, "number of fieldsets").toBe(2);
      const [quiet] = fieldsetsOf(page);
      expect(compact(quiet?.legend ?? ""), "legend").toBe(
        `<label><input type="checkbox" name="quiet_hours" value="on"> ${escapeHtml(texts.quietHoursLabel)}</label>`,
      );
      expect(inputTag(quiet?.content ?? "", "quiet_start"), "start field in the group").toContain('id="quiet_start"');
      expect(inputTag(quiet?.content ?? "", "quiet_end"), "end field in the group").toContain('id="quiet_end"');
      expect(quiet?.content, "start label").toContain(escapeHtml(texts.quietStartLabel));
      expect(quiet?.content, "end label").toContain(escapeHtml(texts.quietEndLabel));
      expect(quiet?.content, "rules").not.toContain('name="rule_');
      expect(page.indexOf('id="time_zone"'), "the selects come before the groups").toBeLessThan(
        page.indexOf("<fieldset"),
      );
      expect(page.indexOf('action="/setup/settings"'), "the groups are in the settings form").toBeLessThan(
        page.indexOf("<fieldset"),
      );
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage puts the eight rules and the release notice in one fieldset with the rules label as legend in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language);

      const rules = fieldsetsOf(page)[1];
      expect(compact(rules?.legend ?? ""), "legend").toBe(escapeHtml(texts.rulesLabel));
      const names = [...RULE_IDS.map((id) => `rule_${id}`), "update_notice"];
      expect(RULE_IDS.length, "number of rules").toBe(8);
      const positions = names.map((name) => (rules?.content ?? "").indexOf(`name="${name}"`));
      expect(Math.min(...positions), "every switch is in the group").toBeGreaterThanOrEqual(0);
      expect(positions, "the rules come in order, then the release notice").toEqual(
        [...positions].sort((left, right) => left - right),
      );
      expect(rules?.content, "quiet hours").not.toContain('name="quiet_');
      expect(page, "rules label as a paragraph").not.toContain(`<p>${escapeHtml(texts.rulesLabel)}</p>`);
      const settings = sectionWith(page, `<h2>${escapeHtml(texts.settingsHeading)}</h2>`);
      expect(settings.lastIndexOf("</fieldset>"), "the groups are in the settings section").toBeGreaterThanOrEqual(0);
      const afterGroups = settings.slice(settings.lastIndexOf("</fieldset>"));
      expect(buttonClasses(afterGroups), "save button after the groups").toEqual(["primary"]);
    },
  );
});

describe("long and many texts", () => {
  it("renderStartPage shows a 300-character login and enterprise slug in full, escaped", () => {
    const login = "a&b".repeat(100);
    const slug = "s<t".repeat(100);
    expect(login.length + slug.length, "length of the texts").toBe(600);

    const page = startPage("en", {
      installations: listed([
        installationOf({ kind: "login", login, type: "User" }),
        installationOf({ kind: "enterprise", slug }),
      ]),
    });

    const status = sectionWith(page, `<h2>${escapeHtml(TEXTS.en.statusHeading)}</h2>`);
    expect(status, "login in full in the status card").toContain(
      `<li>${escapeHtml(login)} (personal account), selected repositories</li>`,
    );
    expect(status, "slug in full in the status card").toContain(
      `<li>${escapeHtml(slug)} (enterprise), selected repositories</li>`,
    );
    expect(page, "unescaped slug").not.toContain("s<t");
  });

  it("renderTelegramPage shows a 128-character name without spaces in full", () => {
    const name = "Ab&".repeat(42) + "AB";
    expect(name.length, "length of the name").toBe(128);

    const page = renderTelegramPage("en", CSRF_TOKEN, {
      kind: "step",
      token: WORKER_SECRET_TOKEN,
      chat: { kind: "chats", chats: [{ id: 7, kind: "group", name, username: undefined }], savedChatId: undefined },
    });

    const cards = sectionsOf(mainOf(page));
    expect(cards.length, "number of cards: token card and chat card").toBe(2);
    expect(cards[1]?.html, "name in full in the chat card").toContain(`<bdi>${escapeHtml(name)}</bdi>`);
  });

  it("renderTelegramPage lists 100 chats", () => {
    const chats: TelegramChat[] = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      kind: "group",
      name: `Chat ${String(index)}`,
      username: undefined,
    }));

    const page = renderTelegramPage("en", CSRF_TOKEN, {
      kind: "step",
      token: WORKER_SECRET_TOKEN,
      chat: { kind: "chats", chats, savedChatId: undefined },
    });

    const cards = sectionsOf(mainOf(page));
    expect(cards.length, "number of cards: token card and chat card").toBe(2);
    expect(cards[1]?.html.match(/<input type="radio"/g)?.length, "radio buttons in the chat card").toBe(100);
    expect(cards[1]?.html.match(/<bdi>Chat \d+<\/bdi>/g)?.length, "names in the chat card").toBe(100);
  });

  it("the status card holds 100 installations and the more installations text", () => {
    const hundred = Array.from({ length: 100 }, (_, index) =>
      installationOf({ kind: "login", login: `user${String(index)}`, type: "User" }, { id: index + 1 }),
    );

    const page = startPage("en", { installations: listed(hundred, true) });

    const status = sectionWith(page, `<h2>${escapeHtml(TEXTS.en.statusHeading)}</h2>`);
    expect(status.match(/<li>user\d+ \(personal account\)/g)?.length, "entries in the status card").toBe(100);
    expect(status, "more text in the status card").toContain(escapeHtml(TEXTS.en.moreInstallations));
  });
});

describe("renderStartPage status", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows the status lines in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language);

      expect(page, "status heading").toContain(escapeHtml(texts.statusHeading));
      expect(page, "version line").toMatch(new RegExp(`${escapeHtml(texts.versionLabel)}[\\s\\S]{0,40}1\\.2\\.3-test`));
      expect(page, "bot token line").toContain(
        `<p>${escapeHtml(texts.botTokenLabel)} ${escapeHtml(texts.botTokenSecret)}</p>`,
      );
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
        texts.botTokenLabel,
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

  it.each(
    LANGUAGES.flatMap(
      (language) =>
        [
          { language, botToken: "worker-secret", key: "botTokenSecret" },
          { language, botToken: "saved", key: "botTokenSaved" },
          { language, botToken: "none", key: "noneSavedYet" },
          { language, botToken: "unreadable", key: "cannotBeRead" },
        ] as const,
    ),
  )(
    "renderStartPage shows the Telegram bot token line before the Telegram chat line for $botToken in $language",
    ({ language, botToken, key }) => {
      const texts = TEXTS[language];

      const page = startPage(language, { botToken });

      const line = `<p>${escapeHtml(texts.botTokenLabel)} ${escapeHtml(texts[key])}</p>`;
      expect(page, "bot token line directly before the chat line").toMatch(
        new RegExp(`${escapeRegExp(line)}\\s*<p>${escapeRegExp(escapeHtml(texts.telegramChatLabel))}`),
      );
      expect(page.split(escapeHtml(texts.botTokenLabel)).length - 1, "bot token lines").toBe(1);
    },
  );

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

/** The installation of an account, selected repositories, not suspended. */
function installationOf(account: Installation["account"], changes: Partial<Installation> = {}): Installation {
  return { id: 1, account, repositorySelection: "selected", suspended: false, access: undefined, ...changes };
}

function listed(installations: readonly Installation[], more = false): InstallationsView {
  return {
    kind: "listed",
    installations: installations.map((installation) => ({ installation, check: { kind: "app-unchecked" } })),
    more,
  };
}

/** The installations part of the status section of the start page, from its paragraph to the last delivery paragraph. */
function installationsSection(language: Language, installations: InstallationsView): string {
  const page = startPage(language, { installations });
  const start = page.indexOf(TEXTS[language].installationsLabel);
  const end = page.indexOf(`<p>${escapeHtml(TEXTS[language].lastDeliveryLabel)}`);
  return start < 0 || end < 0 ? "" : page.slice(start - "<p>".length, end);
}

describe("renderStartPage installations", () => {
  it("renderStartPage lists the installations in a list below the GitHub App line, in the given order", () => {
    const page = startPage("en", {
      installations: listed([
        installationOf({ kind: "login", login: "octocat", type: "User" }, { repositorySelection: "all" }),
        installationOf({ kind: "login", login: "octo-org", type: "Organization" }),
      ]),
    });

    expect(page, "installations block").toContain(
      "<p>Installations:</p>\n<ul>\n" +
        "<li>octocat (personal account), all repositories</li>\n" +
        "<li>octo-org (organization), selected repositories</li>\n</ul>",
    );
    const order = [TEXTS.en.githubAppLabel, TEXTS.en.installationsLabel, TEXTS.en.lastDeliveryLabel].map((text) =>
      page.indexOf(escapeHtml(text)),
    );
    expect(order, "the installations come between the GitHub App line and the last delivery").toEqual(
      [...order].sort((a, b) => a - b),
    );
    expect(Math.min(...order), "every text is on the page").toBeGreaterThanOrEqual(0);
  });

  it.each<{ case: string; account: Installation["account"]; changes?: Partial<Installation>; en: string; de: string }>([
    {
      case: "a personal account",
      account: { kind: "login", login: "octocat", type: "User" },
      en: "octocat (personal account), selected repositories",
      de: "octocat (persönliches Konto), ausgewählte Repositories",
    },
    {
      case: "an organization",
      account: { kind: "login", login: "octo-org", type: "Organization" },
      changes: { repositorySelection: "all" },
      en: "octo-org (organization), all repositories",
      de: "octo-org (Organisation), alle Repositories",
    },
    {
      case: "an account of another type",
      account: { kind: "login", login: "robot", type: "Bot" },
      en: "robot (other account), selected repositories",
      de: "robot (anderes Konto), ausgewählte Repositories",
    },
    {
      case: "an account without a type",
      account: { kind: "login", login: "octocat", type: undefined },
      en: "octocat (other account), selected repositories",
      de: "octocat (anderes Konto), ausgewählte Repositories",
    },
    {
      case: "an enterprise",
      account: { kind: "enterprise", slug: "acme" },
      en: "acme (enterprise), selected repositories",
      de: "acme (Enterprise), ausgewählte Repositories",
    },
    {
      case: "an unknown account",
      account: { kind: "unknown" },
      en: "Unknown account, selected repositories",
      de: "Unbekanntes Konto, ausgewählte Repositories",
    },
    {
      case: "a suspended installation",
      account: { kind: "login", login: "octocat", type: "User" },
      changes: { suspended: true },
      en: "octocat (personal account), selected repositories, suspended",
      de: "octocat (persönliches Konto), ausgewählte Repositories, gesperrt",
    },
    {
      case: "a suspended installation of an unknown account on all repositories",
      account: { kind: "unknown" },
      changes: { suspended: true, repositorySelection: "all" },
      en: "Unknown account, all repositories, suspended",
      de: "Unbekanntes Konto, alle Repositories, gesperrt",
    },
  ])("the status section lists $case in English and German", ({ account, changes, en, de }) => {
    const view = listed([installationOf(account, changes)]);

    const english = startPage("en", { installations: view });
    const german = startPage("de", { installations: view });

    expect(english, "English entry").toContain(`<li>${en}</li>`);
    expect(german, "German entry").toContain(`<li>${de}</li>`);
  });

  it.each([
    {
      case: "a login",
      account: { kind: "login", login: '<script>alert("x")</script>&', type: "User" } as const,
      escaped: "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp; (personal account)",
    },
    {
      case: "a slug",
      account: { kind: "enterprise", slug: "<img src=x onerror=y>'" } as const,
      escaped: "&lt;img src=x onerror=y&gt;&#39; (enterprise)",
    },
  ])("the status section lists $case escaped, never as markup", ({ account, escaped }) => {
    const page = startPage("en", { installations: listed([installationOf(account)]) });

    expect(page, "entry").toContain(`<li>${escaped}, selected repositories</li>`);
    expect(page, "script tag").not.toContain("<script>");
    expect(page, "image tag").not.toContain("<img");
  });

  it("the status section shows not installed for an empty list", () => {
    const section = installationsSection("en", listed([]));

    expect(section, "section").toBe("<p>Installations: Not installed on any account yet.</p>\n");
  });

  it("the status section shows not installed in German for an empty list", () => {
    const section = installationsSection("de", listed([]));

    expect(section, "section").toBe("<p>Installationen: Noch auf keinem Konto installiert.</p>\n");
  });

  it("the status section shows the more installations text exactly when more is set", () => {
    const entry = installationOf({ kind: "login", login: "octocat", type: "User" });

    const withMore = startPage("en", { installations: listed([entry], true) });
    const withoutMore = startPage("en", { installations: listed([entry], false) });

    expect(withMore, "text with more").toContain("</ul>\n<p>Only the first 100 installations are shown.</p>");
    expect(withoutMore, "text without more").not.toContain("Only the first 100 installations are shown.");
  });

  it("the status section shows the more installations text in German after the entries", () => {
    const entry = installationOf({ kind: "login", login: "octocat", type: "User" });

    const page = startPage("de", { installations: listed([entry], true) });

    expect(page, "text").toContain("</ul>\n<p>Nur die ersten 100 Installationen werden angezeigt.</p>");
  });

  it("the status section shows 100 entries without more and without the text", () => {
    const hundred = Array.from({ length: 100 }, (_, index) =>
      installationOf({ kind: "login", login: `user${String(index)}`, type: "User" }, { id: index + 1 }),
    );

    const page = startPage("en", { installations: listed(hundred) });

    expect(page.match(/<li>user\d+ \(personal account\)/g)?.length, "number of entries").toBe(100);
    expect(page, "more text").not.toContain("Only the first 100 installations are shown.");
  });

  it.each([
    {
      language: "en",
      unavailable: "Cannot be loaded from GitHub right now.",
      unusable: "The app's private key cannot be used.",
      label: "Installations:",
    },
    {
      language: "de",
      unavailable: "Kann gerade nicht von GitHub geladen werden.",
      unusable: "Der private Schlüssel der App ist nicht verwendbar.",
      label: "Installationen:",
    },
  ] as const)(
    "the status section shows the unavailable and key unusable texts in $language",
    ({ language, unavailable, unusable, label }) => {
      const unavailableSection = installationsSection(language, { kind: "unavailable" });
      const unusableSection = installationsSection(language, { kind: "key-unusable" });

      expect(unavailableSection, "unavailable section").toBe(`<p>${label} ${escapeHtml(unavailable)}</p>\n`);
      expect(unusableSection, "key unusable section").toBe(`<p>${label} ${escapeHtml(unusable)}</p>\n`);
    },
  );
});

const APP_SETTINGS_URL = "https://github.com/settings/apps/seluna-demo/permissions";
const INSTALLATION_URL = "https://github.com/settings/installations/1";
const OCTOCAT_ACCOUNT: Installation["account"] = { kind: "login", login: "octocat", type: "User" };

function ownerOf(login: string, type: "User" | "Organization"): StatusView["owner"] {
  return { kind: "known", owner: { id: 7, login, type } };
}

function checkedApp(permissions: readonly string[], events: readonly string[]): StatusView["appAccess"] {
  return { kind: "checked", missing: { permissions, events }, settingsUrl: APP_SETTINGS_URL };
}

/** The app check with something missing and no link to build. */
function checkedAppWithoutLink(permissions: readonly string[]): StatusView["appAccess"] {
  return { kind: "checked", missing: { permissions, events: [] }, settingsUrl: undefined };
}

/** The installation `octocat` with `check`, as a listed view. */
function listedWithCheck(
  check: InstallationEntry["check"],
  changes: Partial<Installation> = {},
): StatusView["installations"] {
  return {
    kind: "listed",
    installations: [{ installation: installationOf(OCTOCAT_ACCOUNT, changes), check }],
    more: false,
  };
}

/** The status card of the start page. */
function statusCardOf(language: Language, changes: Partial<StatusView>): string {
  return sectionWith(startPage(language, changes), `<h2>${escapeHtml(TEXTS[language].statusHeading)}</h2>`);
}

describe("renderStartPage owner line", () => {
  it("the status page shows the owner line for a personal account in en", () => {
    const status = statusCardOf("en", { owner: ownerOf("octocat", "User") });

    expect(status, "owner line").toContain("<p>GitHub App owner: octocat (personal account)</p>");
    expect(status, "organization notice").not.toContain("belongs to an organization");
  });

  it("the status page shows the owner line for a personal account in de", () => {
    const status = statusCardOf("de", { owner: ownerOf("octocat", "User") });

    expect(status, "owner line").toMatch(/<p>[^<]+ octocat \(persönliches Konto\)<\/p>/);
  });

  it("the status page adds the organization notice for an organization's app in en", () => {
    const status = statusCardOf("en", { owner: ownerOf("octo-org", "Organization") });

    const notice = escapeHtml(
      "The app belongs to an organization, so Seluna cannot tell your own actions from anyone else's: activity of every account is reported, yours too.",
    );
    expect(status, "owner line and notice").toContain(
      `<p>GitHub App owner: octo-org (organization)</p>\n<p>${notice}</p>`,
    );
  });

  it("the status page adds the organization notice for an organization's app in de", () => {
    const status = statusCardOf("de", { owner: ownerOf("octo-org", "Organization") });

    expect(status, "owner line and a notice paragraph").toMatch(
      /<p>[^<]+ octo-org \(Organisation\)<\/p>\n<p>[^<]{40,}<\/p>/,
    );
  });

  it.each(LANGUAGES.map((language) => ({ language })))(
    "the status page escapes the owner login in $language",
    ({ language }) => {
      const status = statusCardOf(language, {
        owner: { kind: "known", owner: { id: 7, login: "<b>x</b>&", type: "User" } },
      });

      expect(status, "markup").not.toContain("<b>x</b>");
      expect(status, "escaped login").toContain("&lt;b&gt;x&lt;/b&gt;&amp;");
    },
  );

  it("the status page shows owner unavailable in en", () => {
    const status = statusCardOf("en", { owner: { kind: "unavailable" } });

    expect(status, "owner line").toMatch(/<p>GitHub App owner: [^<]+<\/p>/);
    expect(status, "text").toContain("Cannot be read from GitHub right now.");
    expect(status, "organization notice").not.toContain("belongs to an organization");
  });

  it("the status page shows owner unavailable in de as one more paragraph than without an owner line", () => {
    const hidden = statusCardOf("de", { owner: { kind: "hidden" } });
    const unavailable = statusCardOf("de", { owner: { kind: "unavailable" } });

    expect(unavailable.match(/<p>/g)?.length, "paragraphs").toBe((hidden.match(/<p>/g)?.length ?? 0) + 1);
  });

  it.each(LANGUAGES.map((language) => ({ language })))(
    "the status page shows no owner line, app check or notice when both are hidden in $language",
    ({ language }) => {
      const status = statusCardOf(language, { owner: { kind: "hidden" }, appAccess: { kind: "hidden" } });

      expect(status, "owner label").not.toContain("GitHub App owner");
      expect(status, "organization notice").not.toContain("belongs to an organization");
      expect(status, "missing label").not.toContain("Missing on the app");
      expect(status.match(/<p>/g)?.length, "paragraphs of the status card").toBe(
        statusCardOf(language, {}).match(/<p>/g)?.length,
      );
    },
  );

  it("the status page orders the app line, the owner line and notice, the app check, the installations and the last delivery", () => {
    const status = statusCardOf("en", {
      owner: ownerOf("octo-org", "Organization"),
      appAccess: checkedApp(["issues"], []),
      installations: listedWithCheck({ kind: "complete" }),
    });

    const order = [
      TEXTS.en.githubAppLabel,
      "GitHub App owner:",
      "belongs to an organization",
      "Missing on the app:",
      TEXTS.en.installationsLabel,
      TEXTS.en.lastDeliveryLabel,
    ].map((text) => status.indexOf(escapeHtml(text)));
    expect(Math.min(...order), "every text is on the page").toBeGreaterThanOrEqual(0);
    expect(order, "order").toEqual([...order].sort((left, right) => left - right));
  });
});

describe("renderStartPage app check", () => {
  it("the status page renders the missing line and links in en", () => {
    const status = statusCardOf("en", {
      appAccess: checkedApp(["issues", "vulnerability_alerts"], ["issues", "star"]),
    });

    expect(status, "missing line").toContain(
      `<p>Missing on the app: Issues (read-only), Dependabot alerts (read-only); events: Issues, Star ` +
        `<a href="${APP_SETTINGS_URL}">${escapeHtml("Add them in the app's settings on GitHub")}</a></p>`,
    );
  });

  it("the status page renders the missing line and links in de", () => {
    const status = statusCardOf("de", {
      appAccess: checkedApp(["issues", "vulnerability_alerts"], ["issues", "star"]),
    });

    expect(status, "missing line").toMatch(
      new RegExp(
        `<p>[^<]+ Issues \\(nur lesend\\), Dependabot alerts \\(nur lesend\\); Ereignisse: Issues, Star <a href="${escapeRegExp(APP_SETTINGS_URL)}">[^<]+</a></p>`,
      ),
    );
  });

  it("the status page names every permission and event by GitHub's name in manifest order", () => {
    const status = statusCardOf("en", {
      appAccess: checkedApp(
        [
          "actions",
          "contents",
          "issues",
          "pull_requests",
          "vulnerability_alerts",
          "security_events",
          "secret_scanning_alerts",
          "metadata",
        ],
        [
          "pull_request",
          "workflow_run",
          "dependabot_alert",
          "code_scanning_alert",
          "secret_scanning_alert",
          "issues",
          "issue_comment",
          "fork",
          "star",
        ],
      ),
    });

    expect(status, "list").toContain(
      "Missing on the app: Actions (read-only), Contents (read-only), Issues (read-only), Pull requests (read-only), " +
        "Dependabot alerts (read-only), Code scanning alerts (read-only), Secret scanning alerts (read-only), " +
        "Metadata (read-only); events: Pull request, Workflow run, Dependabot alert, Code scanning alert, " +
        "Secret scanning alert, Issues, Issue comment, Fork, Star ",
    );
  });

  it.each([
    {
      case: "permissions only",
      permissions: ["contents"],
      events: [],
      expected: "Missing on the app: Contents (read-only) <a ",
    },
    {
      case: "events only",
      permissions: [],
      events: ["fork", "star"],
      expected: "Missing on the app: events: Fork, Star <a ",
    },
  ])(
    "the status page renders the missing line for $case without a stray separator",
    ({ permissions, events, expected }) => {
      const status = statusCardOf("en", { appAccess: checkedApp(permissions, events) });

      expect(status, "missing line").toContain(expected);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "the status page renders a missing line without a link when no link is built in $language",
    ({ language }) => {
      const status = statusCardOf(language, { appAccess: checkedAppWithoutLink(["issues"]) });

      expect(status, "missing line").toContain("Issues (");
      expect(status, "link").not.toContain('<a href="https://github.com/settings');
      expect(status.match(/<a href="/g)?.length, "links in the status card").toBe(
        statusCardOf(language, {}).match(/<a href="/g)?.length,
      );
    },
  );

  it("the status page renders the missing line without a link as the bare list in en", () => {
    const status = statusCardOf("en", { appAccess: checkedAppWithoutLink(["issues"]) });

    expect(status, "missing line").toContain("<p>Missing on the app: Issues (read-only)</p>");
  });

  it("the status page says the app's permissions could not be read in en", () => {
    const status = statusCardOf("en", { appAccess: { kind: "unchecked" } });

    expect(status, "unchecked line").toContain(
      `<p>Missing on the app: ${escapeHtml("Seluna could not read the app's permissions from GitHub.")}</p>`,
    );
  });

  it("the status page says the app's permissions could not be read in de as one more paragraph", () => {
    const hidden = statusCardOf("de", { appAccess: { kind: "hidden" } });
    const unchecked = statusCardOf("de", { appAccess: { kind: "unchecked" } });

    expect(unchecked.match(/<p>/g)?.length, "paragraphs").toBe((hidden.match(/<p>/g)?.length ?? 0) + 1);
    expect(unchecked, "no link").not.toContain('<a href="https://github.com/settings');
  });

  it.each(LANGUAGES.map((language) => ({ language })))(
    "the status page renders nothing extra when nothing is missing in $language",
    ({ language }) => {
      const status = statusCardOf(language, {
        appAccess: checkedApp([], []),
        installations: listedWithCheck({ kind: "complete" }),
      });

      const plain = statusCardOf(language, { installations: listedWithCheck({ kind: "app-unchecked" }) });
      expect(status, "status card").toBe(plain);
      expect(status, "settings link").not.toContain("https://github.com/settings");
    },
  );
});

describe("renderStartPage installation checks", () => {
  it("the status page renders the missing suffix and link of an installation in en", () => {
    const status = statusCardOf("en", {
      installations: listedWithCheck({
        kind: "missing",
        missing: { permissions: ["issues"], events: ["star"] },
        acceptUrl: INSTALLATION_URL,
      }),
    });

    expect(status, "entry").toContain(
      "<li>octocat (personal account), selected repositories, missing: Issues (read-only); events: Star " +
        `<a href="${INSTALLATION_URL}">Review and accept on GitHub</a></li>`,
    );
  });

  it("the status page renders the missing suffix and link of an installation in de", () => {
    const status = statusCardOf("de", {
      installations: listedWithCheck({
        kind: "missing",
        missing: { permissions: ["issues"], events: ["star"] },
        acceptUrl: INSTALLATION_URL,
      }),
    });

    expect(status, "entry").toMatch(
      new RegExp(
        `<li>octocat \\(persönliches Konto\\), ausgewählte Repositories, [^<]+ Issues \\(nur lesend\\); Ereignisse: Star <a href="${escapeRegExp(INSTALLATION_URL)}">[^<]+</a></li>`,
      ),
    );
  });

  it("the status page puts the missing suffix after the suspended text", () => {
    const status = statusCardOf("en", {
      installations: listedWithCheck(
        { kind: "missing", missing: { permissions: ["issues"], events: [] }, acceptUrl: undefined },
        { suspended: true, repositorySelection: "all" },
      ),
    });

    expect(status, "entry").toContain(
      "<li>octocat (personal account), all repositories, suspended, missing: Issues (read-only)</li>",
    );
  });

  it("the status page renders the missing suffix of an installation without a link when none is built", () => {
    const status = statusCardOf("en", {
      installations: listedWithCheck({
        kind: "missing",
        missing: { permissions: ["contents"], events: [] },
        acceptUrl: undefined,
      }),
    });

    expect(status, "entry").toContain(
      "<li>octocat (personal account), selected repositories, missing: Contents (read-only)</li>",
    );
    expect(status, "link").not.toContain("Review and accept");
  });

  it("the status page renders access not checked for an installation in en", () => {
    const status = statusCardOf("en", { installations: listedWithCheck({ kind: "unreadable" }) });

    expect(status, "entry").toContain("<li>octocat (personal account), selected repositories, access not checked</li>");
  });

  it("the status page renders a suffix after the suspended text for an installation whose access cannot be read in de", () => {
    const status = statusCardOf("de", { installations: listedWithCheck({ kind: "unreadable" }, { suspended: true }) });

    expect(status, "entry").toMatch(
      /<li>octocat \(persönliches Konto\), ausgewählte Repositories, gesperrt, [^<]+<\/li>/,
    );
  });

  it("the status page renders access not checked in de as a suffix", () => {
    const status = statusCardOf("de", { installations: listedWithCheck({ kind: "unreadable" }) });

    expect(status, "entry").toMatch(/<li>octocat \(persönliches Konto\), ausgewählte Repositories, [^<]+<\/li>/);
  });

  it.each(LANGUAGES.map((language) => ({ language })))(
    "the status page adds nothing to an installation that is complete or whose app is unchecked in $language",
    ({ language }) => {
      const complete = statusCardOf(language, { installations: listedWithCheck({ kind: "complete" }) });
      const unchecked = statusCardOf(language, { installations: listedWithCheck({ kind: "app-unchecked" }) });

      expect(complete, "complete").toBe(unchecked);
      expect(complete, "entry").toMatch(/<li>octocat \([^)]+\), [^,<]+<\/li>/);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "the status page has exactly its own external addresses with the owner, the app check and an installation check in $language",
    ({ language }) => {
      const page = startPage(language, {
        owner: ownerOf("octo-org", "Organization"),
        appAccess: checkedApp(["issues"], ["star"]),
        installations: listedWithCheck({
          kind: "missing",
          missing: { permissions: ["issues"], events: [] },
          acceptUrl: INSTALLATION_URL,
        }),
      });

      expect(
        [...attributeValues(page, "src"), ...attributeValues(page, "href"), ...attributeValues(page, "action")].filter(
          (value) => /^(?:https?:)?\/\//i.test(value),
        ),
        "external addresses in src, href and action",
      ).toEqual([SLUG_LINK, APP_SETTINGS_URL, INSTALLATION_URL]);
    },
  );
});

describe("renderStartPage hidden installations", () => {
  it.each([{ language: "en" as const }, { language: "de" as const }])(
    "the status section shows no installations label or text in $language when they are hidden",
    ({ language }) => {
      const spec = SPEC_INSTALLATION_TEXTS[language];

      const page = startPage(language, { installations: { kind: "hidden" } });

      expect(page, "status section").toContain(escapeHtml(TEXTS[language].statusHeading));
      expect(page, "label").not.toContain(spec.label);
      expect(page, "not installed text").not.toContain(spec.notInstalled);
      expect(page, "unavailable text").not.toContain(escapeHtml(spec.unavailable));
      expect(page, "key unusable text").not.toContain(escapeHtml(spec.keyUnusable));
      expect(page, "more text").not.toContain(spec.more);
    },
  );
});

/** The texts of the spec (Non-functional requirements, Texts), written out independently of `src/setup/texts.ts`. */
const SPEC_INSTALLATION_TEXTS = {
  en: {
    label: "Installations:",
    personal: "personal account",
    organization: "organization",
    other: "other account",
    enterprise: "enterprise",
    unknown: "Unknown account",
    all: "all repositories",
    selected: "selected repositories",
    suspended: "suspended",
    notInstalled: "Not installed on any account yet.",
    more: "Only the first 100 installations are shown.",
    unavailable: "Cannot be loaded from GitHub right now.",
    keyUnusable: "The app's private key cannot be used.",
  },
  de: {
    label: "Installationen:",
    personal: "persönliches Konto",
    organization: "Organisation",
    other: "anderes Konto",
    enterprise: "Enterprise",
    unknown: "Unbekanntes Konto",
    all: "alle Repositories",
    selected: "ausgewählte Repositories",
    suspended: "gesperrt",
    notInstalled: "Noch auf keinem Konto installiert.",
    more: "Nur die ersten 100 Installationen werden angezeigt.",
    unavailable: "Kann gerade nicht von GitHub geladen werden.",
    keyUnusable: "Der private Schlüssel der App ist nicht verwendbar.",
  },
} as const;

describe("renderStartPage installations texts", () => {
  it.each([{ language: "en" as const }, { language: "de" as const }])(
    "the installations texts are the $language texts of the spec",
    ({ language }) => {
      const spec = SPEC_INSTALLATION_TEXTS[language];
      const everyKind = listed(
        [
          installationOf({ kind: "login", login: "a", type: "User" }, { repositorySelection: "all" }),
          installationOf({ kind: "login", login: "b", type: "Organization" }),
          installationOf({ kind: "login", login: "c", type: "Bot" }, { suspended: true }),
          installationOf({ kind: "enterprise", slug: "d" }),
          installationOf({ kind: "unknown" }),
        ],
        true,
      );

      const entries = startPage(language, { installations: everyKind });
      const empty = startPage(language, { installations: listed([]) });
      const unavailable = startPage(language, { installations: { kind: "unavailable" } });
      const unusable = startPage(language, { installations: { kind: "key-unusable" } });

      expect(entries, "label").toContain(`<p>${spec.label}</p>`);
      expect(entries, "list").toContain(
        [
          `<li>a (${spec.personal}), ${spec.all}</li>`,
          `<li>b (${spec.organization}), ${spec.selected}</li>`,
          `<li>c (${spec.other}), ${spec.selected}, ${spec.suspended}</li>`,
          `<li>d (${spec.enterprise}), ${spec.selected}</li>`,
          `<li>${spec.unknown}, ${spec.selected}</li>`,
        ].join("\n"),
      );
      expect(entries, "more text").toContain(`<p>${spec.more}</p>`);
      expect(empty, "not installed text").toContain(`<p>${spec.label} ${spec.notInstalled}</p>`);
      expect(unavailable, "unavailable text").toContain(`<p>${spec.label} ${spec.unavailable}</p>`);
      expect(unusable, "key unusable text").toContain(`<p>${spec.label} ${escapeHtml(spec.keyUnusable)}</p>`);
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

interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}

interface CssRule {
  /** The condition of the enclosing `@media`, or undefined. */
  readonly media: string | undefined;
  readonly selectors: readonly string[];
  readonly declarations: readonly CssDeclaration[];
}

/** `text` split at `separator` outside of parentheses and brackets, each part trimmed, empty parts left out. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index);
    if (character === "(" || character === "[") {
      depth++;
    } else if (character === ")" || character === "]") {
      depth--;
    } else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function declarationsOf(text: string): CssDeclaration[] {
  return splitTopLevel(text, ";").flatMap((declaration) => {
    const colon = declaration.indexOf(":");
    return colon < 0
      ? []
      : [
          {
            property: declaration.slice(0, colon).trim().toLowerCase(),
            value: declaration
              .slice(colon + 1)
              .replaceAll(/\s+/g, " ")
              .trim(),
          },
        ];
  });
}

/** The index after the `}` that closes the block opened at `open`. */
function blockEnd(style: string, open: number): number {
  let depth = 1;
  let close = open + 1;
  while (close < style.length && depth > 0) {
    const character = style.charAt(close);
    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    }
    close++;
  }
  return close;
}

/** The rules of a style sheet, with the rules inside one level of `@media` carrying its condition. */
function cssRules(style: string, media?: string): CssRule[] {
  const rules: CssRule[] = [];
  let index = 0;
  for (let open = style.indexOf("{", index); open >= 0; open = style.indexOf("{", index)) {
    const close = blockEnd(style, open);
    const prelude = style.slice(index, open).trim();
    const inner = style.slice(open + 1, close - 1);
    if (prelude.startsWith("@media")) {
      rules.push(...cssRules(inner, prelude.slice("@media".length).replaceAll(/\s+/g, "")));
    } else {
      rules.push({ media, selectors: splitTopLevel(prelude, ","), declarations: declarationsOf(inner) });
    }
    index = close;
  }
  return rules;
}

const DARK_MEDIA = "(prefers-color-scheme:dark)";
const HEX_COLOUR = /^#[0-9a-f]{6}$/;

type Mode = "light" | "dark";

/** The custom properties of `:root` in the light set or inside the dark `@media` block, lower-cased. */
function colours(style: string, mode: Mode): ReadonlyMap<string, string> {
  const palette = new Map<string, string>();
  for (const rule of cssRules(style)) {
    const inMode = mode === "dark" ? rule.media === DARK_MEDIA : rule.media === undefined;
    if (inMode && rule.selectors.includes(":root")) {
      for (const { property, value } of rule.declarations) {
        if (property.startsWith("--")) {
          palette.set(property, value.toLowerCase());
        }
      }
    }
  }
  return palette;
}

function colourOf(palette: ReadonlyMap<string, string>, name: string): string {
  const value = palette.get(name);
  if (value === undefined || !HEX_COLOUR.test(value)) {
    throw new Error(`${name} is not declared as #rrggbb (found: ${value ?? "nothing"})`);
  }
  return value;
}

function channelLuminance(hex: string, offset: number): number {
  const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance of a `#rrggbb` colour (WCAG 2.1). */
function luminance(hex: string): number {
  return 0.2126 * channelLuminance(hex, 1) + 0.7152 * channelLuminance(hex, 3) + 0.0722 * channelLuminance(hex, 5);
}

/** The WCAG 2.1 contrast ratio of two `#rrggbb` colours, not rounded. */
function contrastRatio(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

const REQUIRED_COLOURS = [
  "--bg",
  "--fg",
  "--card",
  "--border",
  "--control",
  "--link",
  "--primary",
  "--on-primary",
  "--secondary",
  "--on-secondary",
  "--danger",
  "--on-danger",
  "--error-bg",
  "--error-fg",
  "--error-border",
  "--info-bg",
  "--info-fg",
  "--info-border",
  "--focus",
] as const;

const MODES: readonly Mode[] = ["light", "dark"];

const CONTRAST_PAIRS: readonly (readonly [string, string, number])[] = [
  ["--fg", "--bg", 4.5],
  ["--fg", "--card", 4.5],
  ["--link", "--card", 4.5],
  ["--link", "--bg", 4.5],
  ["--on-primary", "--primary", 4.5],
  ["--on-secondary", "--secondary", 4.5],
  ["--on-danger", "--danger", 4.5],
  ["--error-fg", "--error-bg", 4.5],
  ["--info-fg", "--info-bg", 4.5],
  ["--border", "--bg", 3],
  ["--control", "--card", 3],
  ["--control", "--bg", 3],
  ["--primary", "--card", 3],
  ["--danger", "--card", 3],
  ["--error-border", "--card", 3],
  ["--error-border", "--bg", 3],
  ["--info-border", "--card", 3],
  ["--info-border", "--bg", 3],
  ["--focus", "--bg", 3],
  ["--focus", "--card", 3],
];

/** A length in `rem` (`px` at 16 per rem), or undefined for a value that is not an absolute length or `rem`/`em`. */
function lengthInRem(value: string): number | undefined {
  const match = /^(\d+\.\d+|\d+|\.\d+)(px|pt|cm|mm|in|rem|em)$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const rem = { px: 1 / 16, pt: 1 / 12, cm: 96 / 2.54 / 16, mm: 96 / 25.4 / 16, in: 6, rem: 1, em: 1 }[match[2] ?? ""];
  return rem === undefined ? undefined : Number(match[1]) * rem;
}

/** The value of the last declaration of `property` among `rules`, or undefined. */
function declaredValue(rules: readonly CssRule[], property: string): string | undefined {
  return rules
    .flatMap((rule) => rule.declarations)
    .filter((declaration) => declaration.property === property)
    .at(-1)?.value;
}

/** The rules whose selector list holds exactly `selector`. */
function rulesFor(selector: string): CssRule[] {
  return cssRules(STYLE).filter((rule) => rule.selectors.includes(selector));
}

describe("STYLE loads nothing", () => {
  it("STYLE loads nothing: no url(, @import or @font-face", () => {
    expect(STYLE, "url(").not.toMatch(/url\(/i);
    expect(STYLE, "@import").not.toMatch(/@import/i);
    expect(STYLE, "@font-face").not.toMatch(/@font-face/i);
    expect(STYLE, "CSS escape").not.toContain("\\");
    expect(STYLE.match(/@[a-z-]+/gi) ?? [], "at-rules").toEqual((STYLE.match(/@media/g) ?? []).map(() => "@media"));
    expect(STYLE, "functions that fetch").not.toMatch(
      /(?<![\w-])(?:-webkit-)?(?:image-set|image|src|cross-fade|element)\(/i,
    );
  });

  it("STYLE is printable ASCII without <", () => {
    expect(STYLE.length, "length of STYLE").toBeGreaterThan(0);
    expect(STYLE, "characters").toMatch(/^[ -~]*$/);
    expect(STYLE, "less-than sign").not.toContain("<");
  });

  it("STYLE names only system and generic font families", () => {
    const allowed = new Set([
      "system-ui",
      "-apple-system",
      "blinkmacsystemfont",
      '"segoe ui"',
      "roboto",
      '"helvetica neue"',
      "arial",
      "sans-serif",
      "ui-monospace",
      "monospace",
    ]);
    const families = cssRules(STYLE)
      .flatMap((rule) => rule.declarations)
      .filter((declaration) => declaration.property === "font-family")
      .flatMap((declaration) => splitTopLevel(declaration.value, ",").map((family) => family.toLowerCase()));

    expect(
      families.filter((family) => !allowed.has(family)),
      "other font families",
    ).toEqual([]);
    expect(
      cssRules(STYLE)
        .flatMap((rule) => rule.declarations)
        .filter((declaration) => declaration.property === "font"),
      "font shorthand",
    ).toEqual([]);
  });

  it("STYLE is at most 8192 bytes as UTF-8", () => {
    expect(new TextEncoder().encode(STYLE).length, "bytes of STYLE").toBeLessThanOrEqual(8192);
  });
});

describe("STYLE colours", () => {
  it("STYLE declares the same colour properties as #rrggbb for light and dark mode", () => {
    const light = colours(STYLE, "light");
    const dark = colours(STYLE, "dark");

    expect(STYLE.match(/@media/g)?.length, "number of media blocks").toBe(1);
    expect(sorted([...light.keys()]), "light properties").toEqual(sorted([...dark.keys()]));
    expect(
      REQUIRED_COLOURS.filter((name) => !light.has(name)),
      "missing properties",
    ).toEqual([]);
    for (const name of REQUIRED_COLOURS) {
      expect(light.get(name), `${name} in light mode`).toMatch(HEX_COLOUR);
      expect(dark.get(name), `${name} in dark mode`).toMatch(HEX_COLOUR);
    }
  });

  it("STYLE uses colours outside :root only through var()", () => {
    const literal = cssRules(STYLE)
      .filter((rule) => !rule.selectors.includes(":root"))
      .flatMap((rule) =>
        rule.declarations.map(
          (declaration) => `${rule.selectors.join(",")}{${declaration.property}:${declaration.value}}`,
        ),
      )
      .filter((text) => /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(text));

    expect(literal, "literal colours").toEqual([]);
  });

  it("STYLE sets color-scheme light dark", () => {
    const root = rulesFor(":root").filter((rule) => rule.media === undefined);

    expect(declaredValue(root, "color-scheme"), "color-scheme").toBe("light dark");
  });

  it.each(
    MODES.flatMap((mode) =>
      CONTRAST_PAIRS.map(([foreground, background, ratio]) => ({
        mode,
        foreground,
        background,
        ratio,
        pair: `${foreground} on ${background}`,
      })),
    ),
  )("in $mode mode $pair has a contrast ratio of at least $ratio", ({ mode, foreground, background, ratio }) => {
    const palette = colours(STYLE, mode);

    const actual = contrastRatio(colourOf(palette, foreground), colourOf(palette, background));

    expect(actual, `contrast ratio of ${foreground} on ${background}`).toBeGreaterThanOrEqual(ratio);
  });

  it.each(MODES.map((mode) => ({ mode })))(
    "in $mode mode the card background differs from the page background",
    ({ mode }) => {
      const palette = colours(STYLE, mode);

      expect(colourOf(palette, "--card"), "card background").not.toBe(colourOf(palette, "--bg"));
    },
  );

  it.each(MODES.map((mode) => ({ mode })))(
    "in $mode mode the card border has a contrast ratio of at least 3 against the page background",
    ({ mode }) => {
      const palette = colours(STYLE, mode);

      const actual = contrastRatio(colourOf(palette, "--border"), colourOf(palette, "--bg"));

      expect(actual, "contrast ratio of the card border").toBeGreaterThanOrEqual(3);
    },
  );

  it("STYLE separates cards by a bottom margin of at least 0.75rem", () => {
    const margin = declaredValue(rulesFor(".card"), "margin-bottom");

    expect(
      lengthInRem(margin ?? ""),
      `margin-bottom of .card (${margin ?? "not declared"}) in rem`,
    ).toBeGreaterThanOrEqual(0.75);
  });
});

describe("STYLE focus and borders", () => {
  const FOCUS_OUTLINE = /^(\d+\.\d+|\d+|\.\d+)px solid var\(--focus\)$/;

  it.each(["a", "button", "input", "select"])(
    "STYLE draws a focus outline of at least 2px under focus-visible for %s (links, buttons, inputs, selects, checkboxes and radio buttons)",
    (element) => {
      const covering = cssRules(STYLE).filter(
        (rule) =>
          rule.media === undefined &&
          rule.selectors.some((selector) =>
            [`${element}:focus-visible`, ":focus-visible", "*:focus-visible"].includes(selector),
          ),
      );

      const outline = declaredValue(covering, "outline");
      expect(
        Number(FOCUS_OUTLINE.exec(outline ?? "")?.[1]),
        `outline (${outline ?? "not declared"}) width in px`,
      ).toBeGreaterThanOrEqual(2);
      expect(declaredValue(covering, "outline-offset"), "outline-offset").toBeDefined();
    },
  );

  it("STYLE never removes the outline under plain focus", () => {
    const plainFocus = cssRules(STYLE).filter((rule) =>
      rule.selectors.some((selector) => /:focus(?!-)/.test(selector)),
    );

    for (const rule of plainFocus) {
      for (const { property, value } of rule.declarations) {
        const removes =
          (property === "outline" && /^(?:none|0|0px)\b/.test(value)) ||
          (property === "outline-style" && value === "none") ||
          (property === "outline-width" && value.startsWith("0"));
        expect(removes, `${rule.selectors.join(",")}{${property}:${value}}`).toBe(false);
      }
    }
  });

  it.each([".card", "button", "input", "select", ".notice"])("STYLE gives %s a border", (selector) => {
    const border = declaredValue(rulesFor(selector), "border");

    expect(border, `border of ${selector}`).toBeDefined();
    expect(border, `border of ${selector}`).not.toMatch(/^(?:none|0)\b/);
  });
});

describe("STYLE widths", () => {
  const ALL_DECLARATIONS = (): { selectors: string; property: string; value: string }[] =>
    cssRules(STYLE).flatMap((rule) =>
      rule.declarations.map(({ property, value }) => ({ selectors: rule.selectors.join(","), property, value })),
    );

  it("STYLE wraps long words in the body", () => {
    const body = rulesFor("body");

    const wrap = declaredValue(body, "overflow-wrap");
    expect(
      wrap === "anywhere" || (wrap === "break-word" && declaredValue(body, "word-break") === "break-word"),
      `overflow-wrap (${wrap ?? "not declared"}) on the body`,
    ).toBe(true);
  });

  it.each(["input", "select", "button"])("STYLE keeps %s within its container", (element) => {
    const rules = rulesFor(element);

    expect(declaredValue(rules, "box-sizing"), `box-sizing of ${element}`).toBe("border-box");
    expect(declaredValue(rules, "max-width"), `max-width of ${element}`).toBe("100%");
  });

  it("STYLE limits the main column by max-width in rem only", () => {
    const main = rulesFor("main");

    expect(declaredValue(main, "max-width"), "max-width of main").toMatch(/^(?:\d+\.\d+|\d+|\.\d+)rem$/);
    expect(declaredValue(main, "width"), "width of main").toBeUndefined();
  });

  it("STYLE has no nowrap, no pre, no fixed width above 20rem and no fixed height", () => {
    const declarations = ALL_DECLARATIONS();

    expect(
      declarations.filter(
        ({ property, value }) => property === "white-space" && (value.includes("nowrap") || value === "pre"),
      ),
      "white-space",
    ).toEqual([]);
    expect(
      declarations.filter(({ property }) => property === "height" || property === "max-height"),
      "height",
    ).toEqual([]);
    expect(
      declarations.filter(
        ({ property, value }) =>
          ["width", "min-width", "flex-basis"].includes(property) && (lengthInRem(value) ?? 0) > 20,
      ),
      "widths above 20rem",
    ).toEqual([]);
  });

  it("STYLE sizes fonts only in rem, em or %", () => {
    const sizes = ALL_DECLARATIONS().filter(({ property }) => property === "font-size");

    expect(
      sizes.filter(({ value }) => !/^(?:\d+\.\d+|\d+|\.\d+)(?:rem|em|%)$/.test(value)),
      "font sizes in other units",
    ).toEqual([]);
  });
});

describe("STYLE step navigation", () => {
  it("STYLE shows the current item of the step navigation in bold in the text colour", () => {
    const rules = rulesFor(".steps [aria-current=page]");

    expect(rules.length, "rules for the current item").toBeGreaterThan(0);
    expect(declaredValue(rules, "font-weight"), "font-weight").toBe("700");
    expect([undefined, "var(--fg)"], "colour of the current item").toContain(declaredValue(rules, "color"));
    expect([undefined, "none"], "text decoration of the current item").toContain(
      declaredValue(rules, "text-decoration"),
    );
  });

  it("STYLE gives the header the card background", () => {
    expect(declaredValue(rulesFor("header.site"), "background"), "background of header.site").toBe("var(--card)");
  });
});

/** The inside of the card whose heading is the Messengers heading of `language`, or an empty text. */
function messengersCard(html: string, language: Language): string {
  return sectionWith(html, `<h2>${escapeHtml(TEXTS[language].messengersHeading)}</h2>`);
}

/** The `li` elements of the Messengers card in order. */
function messengerItems(html: string, language: Language): string[] {
  return Array.from(messengersCard(html, language).matchAll(/<li>([\s\S]*?)<\/li>/g), (match) => match[1] ?? "");
}

/** The actions of the forms in `html` with the value of their hidden `channel` field and their button class. */
function messengerForms(html: string): { action: string; channel: string; classes: string[] }[] {
  return Array.from(html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g), (form) => ({
    action: attributesOf(form[1] ?? "").get("action") ?? "",
    channel: attributesOf(/<input\b(?=[^>]*name="channel")[^>]*>/.exec(form[2] ?? "")?.[0] ?? "").get("value") ?? "",
    classes: buttonClasses(form[2] ?? ""),
  }));
}

/** The links `<a href=…>text</a>` of `html` as pairs. */
function linksOf(html: string): [string, string][] {
  return Array.from(html.matchAll(/<a href="([^"]*)">([\s\S]*?)<\/a>/g), (match): [string, string] => [
    match[1] ?? "",
    match[2] ?? "",
  ]);
}

describe("renderStartPage Messengers card", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows the Messengers card with its heading and intro in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language);

      const card = messengersCard(page, language);
      expect(
        compact(card).startsWith(
          `<h2>${escapeHtml(texts.messengersHeading)}</h2><p>${escapeHtml(texts.messengersIntro)}</p>`,
        ),
        "heading and intro",
      ).toBe(true);
      expect(card, "list").toMatch(/<ul>[\s\S]*<\/ul>/);
    },
  );

  it.each(
    LANGUAGES.flatMap(
      (language) =>
        [
          {
            language,
            case: "not set up and not active",
            changes: { configured: false, active: false },
            state: "messengerStateNotSetUp",
            link: "messengerSetUpLink",
          },
          {
            language,
            case: "set up and not active",
            changes: { configured: true, active: false },
            state: "messengerStateSetUp",
            link: "messengerChangeLink",
          },
        ] as const,
    ),
  )(
    "renderStartPage shows a messenger that is $case with its state and link in $language",
    ({ language, changes, state, link }) => {
      const texts = TEXTS[language];
      const entries = [
        entryOf({ id: "first", name: "First", setupPath: "/setup/first", ...changes, active: false }),
        entryOf(),
      ];

      const page = startPage(language, { messengers: messengersOf(entries) });

      const [item] = messengerItems(page, language);
      expect(plainText(item ?? ""), "item text").toContain(`First: ${texts[state]}`);
      expect(linksOf(item ?? ""), "links").toEqual([["/setup/first", texts[link]]]);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows a messenger that is set up and active as Active with the Change link in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language, { messengers: messengersOf([entryOf({ configured: true, active: true })]) });

      const [item] = messengerItems(page, language);
      expect(plainText(item ?? ""), "item text").toContain(`Telegram: ${texts.messengerStateActive}`);
      expect(item, "no info notice").not.toContain('class="notice info"');
      expect(linksOf(item ?? ""), "links").toEqual([["/setup/telegram", texts.messengerChangeLink]]);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows a messenger that is active but not set up with the info notice and the Set up link in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language, { messengers: messengersOf([entryOf({ configured: false, active: true })]) });

      const [item] = messengerItems(page, language);
      expect(item, "info notice").toContain(`<p class="notice info">${escapeHtml(texts.messengerActiveNotSetUp)}</p>`);
      expect(linksOf(item ?? ""), "links").toEqual([["/setup/telegram", texts.messengerSetUpLink]]);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows Activate as a primary button only for a set-up messenger that is not active in $language",
    ({ language }) => {
      const texts = TEXTS[language];
      const entries = [
        entryOf({ id: "a", name: "A", setupPath: "/setup/a", configured: false, active: false }),
        entryOf({ id: "b", name: "B", setupPath: "/setup/b", configured: true, active: false }),
        entryOf({ id: "c", name: "C", setupPath: "/setup/c", configured: true, active: true }),
        entryOf({ id: "d", name: "D", setupPath: "/setup/d", configured: false, active: true }),
      ];

      const page = startPage(language, { messengers: messengersOf(entries) });

      const items = messengerItems(page, language);
      expect(
        items.map((item) => messengerForms(item)),
        "forms per messenger",
      ).toEqual([[], [{ action: "/setup/channel/activate", channel: "b", classes: ["primary"] }], [], []]);
      expect(items[1], "button text").toContain(`>${escapeHtml(texts.messengerActivateButton)}</button>`);
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows Remove as a secondary button exactly for a removable messenger, active or not, in $language",
    ({ language }) => {
      const texts = TEXTS[language];
      const entries = [
        entryOf({ id: "a", name: "A", setupPath: "/setup/a", configured: false, active: false, removable: true }),
        entryOf({ id: "b", name: "B", setupPath: "/setup/b", configured: true, active: false, removable: false }),
        entryOf({ id: "c", name: "C", setupPath: "/setup/c", configured: true, active: true, removable: true }),
        entryOf({ id: "d", name: "D", setupPath: "/setup/d", configured: false, active: true, removable: true }),
      ];

      const page = startPage(language, { messengers: messengersOf(entries) });

      const items = messengerItems(page, language);
      expect(
        items.map((item) => messengerForms(item).filter((form) => form.action === "/setup/channel/remove")),
        "remove forms per messenger",
      ).toEqual([
        [{ action: "/setup/channel/remove", channel: "a", classes: ["secondary"] }],
        [],
        [{ action: "/setup/channel/remove", channel: "c", classes: ["secondary"] }],
        [{ action: "/setup/channel/remove", channel: "d", classes: ["secondary"] }],
      ]);
      expect(items[0], "button text").toContain(`>${escapeHtml(texts.messengerRemoveButton)}</button>`);
    },
  );

  it("renderStartPage shows Activate before Remove for a set-up messenger that is not active and removable", () => {
    const entry = entryOf({ configured: true, active: false, removable: true });

    const page = startPage("en", {
      messengers: messengersOf([entryOf({ id: "other", name: "Other", setupPath: "/setup/other" }), entry]),
    });

    const forms = messengerForms(messengerItems(page, "en")[1] ?? "");
    expect(
      forms.map((form) => form.action),
      "form order",
    ).toEqual(["/setup/channel/activate", "/setup/channel/remove"]);
  });

  it("renderStartPage puts the session-bound token and the messenger id into every messenger form", () => {
    const entry = entryOf({ configured: true, active: false, removable: true });

    const page = startPage("en", {
      messengers: messengersOf([entryOf({ id: "other", name: "Other", setupPath: "/setup/other" }), entry]),
    });

    const item = messengerItems(page, "en")[1] ?? "";
    expect(Array.from(item.matchAll(new RegExp(`name="csrf" value="${CSRF_TOKEN}"`, "g"))), "csrf inputs").toHaveLength(
      2,
    );
    expect(attributeValues(item, "method"), "methods").toEqual(["post", "post"]);
    expect(
      messengerForms(item).map((form) => form.channel),
      "channel fields",
    ).toEqual(["telegram", "telegram"]);
    expect(inputTag(item, "channel"), "channel input").toMatch(/type="hidden"/);
  });

  it("renderStartPage lists every messenger in the order of the entries, also those not set up", () => {
    const entries = [
      entryOf({ id: "zeta", name: "Zeta", setupPath: "/setup/zeta", configured: false, active: false }),
      entryOf({ id: "alpha", name: "Alpha", setupPath: "/setup/alpha", configured: true, active: true }),
      entryOf({ id: "mid", name: "Mid", setupPath: "/setup/mid", configured: false, active: false }),
    ];

    const page = startPage("en", { messengers: messengersOf(entries) });

    expect(
      messengerItems(page, "en").map((item) => linksOf(item)[0]?.[0]),
      "setup links in order",
    ).toEqual(["/setup/zeta", "/setup/alpha", "/setup/mid"]);
  });

  it("renderStartPage escapes the name and the setup path of a messenger", () => {
    const entry = entryOf({ id: "x", name: '<script>"&', setupPath: '/setup/"><b>', configured: true, active: false });

    const page = startPage("en", { messengers: messengersOf([entry, entryOf()]) });

    expect(page, "raw script").not.toContain("<script>");
    expect(page, "raw bold").not.toContain("<b>");
    expect(messengerItems(page, "en")[0], "escaped name").toContain(escapeHtml('<script>"&'));
  });
});

describe("renderStartPage Messenger status line", () => {
  /** The text of the _Messenger:_ paragraph of the status section. */
  function messengerLine(page: string, language: Language): string {
    const status = sectionsOf(mainOf(page))[0]?.html ?? "";
    const label = escapeRegExp(escapeHtml(TEXTS[language].messengerLabel));
    return plainText(new RegExp(`<p>${label}[\\s\\S]*?</p>`).exec(status)?.[0] ?? "");
  }

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows Messenger: with the active name right after the Version line in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language);

      expect(messengerLine(page, language), "line").toBe(`${texts.messengerLabel} Telegram`);
      const status = sectionsOf(mainOf(page))[0]?.html ?? "";
      expect(status.indexOf(escapeHtml(texts.versionLabel)), "version before messenger").toBeLessThan(
        status.indexOf(escapeHtml(texts.messengerLabel)),
      );
      expect(status.indexOf(escapeHtml(texts.messengerLabel)), "messenger before the bot token").toBeLessThan(
        status.indexOf(escapeHtml(texts.botTokenLabel)),
      );
    },
  );

  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows (not set up) after the name of an active messenger that is not set up in $language",
    ({ language }) => {
      const texts = TEXTS[language];

      const page = startPage(language, { messengers: messengersOf([entryOf({ configured: false })]) });

      expect(messengerLine(page, language), "line").toBe(
        `${texts.messengerLabel} Telegram ${texts.messengerNotSetUpSuffix}`,
      );
    },
  );

  it("renderStartPage names the active messenger, not the first, in the status line", () => {
    const entries = [
      entryOf({ id: "first", name: "First", setupPath: "/setup/first", active: false }),
      entryOf({ id: "second", name: "Second", setupPath: "/setup/second", configured: true, active: true }),
    ];

    const page = startPage("en", { messengers: messengersOf(entries) });

    expect(messengerLine(page, "en"), "line").toBe("Messenger: Second");
  });

  it("renderStartPage escapes the name of the active messenger in the status line", () => {
    const page = startPage("en", { messengers: messengersOf([entryOf({ name: "<i>x</i>" })]) });

    expect(page, "raw markup").not.toContain("<i>x</i>");
    expect(messengerLine(page, "en"), "line").toBe("Messenger: &lt;i&gt;x&lt;/i&gt;");
  });
});

describe("renderTelegramPage active-but-not-set-up notice", () => {
  const STEP_VIEWS: readonly { readonly case: string; readonly token: TokenState }[] = [
    { case: "a missing token", token: { kind: "missing" } },
    { case: "a saved token", token: { kind: "saved", rejected: false } },
    { case: "a Worker secret token", token: WORKER_SECRET_TOKEN },
  ];

  it.each(
    LANGUAGES.flatMap((language) => STEP_VIEWS.map((view) => ({ language, case: view.case, token: view.token }))),
  )(
    "renderTelegramPage shows the info notice as the first element of the token card after its heading for $case in $language",
    ({ language, token }) => {
      const texts = TEXTS[language];

      const page = renderTelegramPage(language, CSRF_TOKEN, {
        kind: "step",
        token,
        chat: { kind: "hidden", savedChatId: undefined },
        activeNotSetUp: true,
      });

      const card = compact(sectionsOf(mainOf(page))[0]?.html ?? "");
      expect(
        card.startsWith(
          `<h2>${escapeHtml(texts.telegramTokenHeading)}</h2><p class="notice info">${escapeHtml(texts.telegramActiveNotSetUp)}</p>`,
        ),
        "the notice follows the heading",
      ).toBe(true);
    },
  );
});

describe("renderStartPage Messengers card: negatives", () => {
  it.each(LANGUAGES.map((language) => ({ language })))(
    "renderStartPage shows no info notice for a messenger that is not active in $language",
    ({ language }) => {
      const page = startPage(language, {
        messengers: messengersOf([
          entryOf({ configured: false, active: false }),
          entryOf({ id: "second", name: "Second", setupPath: "/setup/second" }),
        ]),
      });

      expect(Array.from(messengersCard(page, language).matchAll(/class="notice info"/g)), "info notices").toEqual([]);
    },
  );

  it("renderStartPage shows no Messengers card in the notice-only view", () => {
    const page = renderStartPage("en", CSRF_TOKEN, { kind: "notice-only" }, "unavailable");

    expect(page, "heading").not.toContain(escapeHtml(TEXTS.en.messengersHeading));
  });

  it.each([
    { case: "activeNotSetUp false", changes: { activeNotSetUp: false } },
    { case: "activeNotSetUp omitted", changes: {} },
  ])("renderTelegramPage shows no Telegram active notice with $case", ({ changes }) => {
    const page = renderTelegramPage("en", CSRF_TOKEN, {
      kind: "step",
      token: { kind: "missing" },
      chat: { kind: "hidden", savedChatId: undefined },
      ...changes,
    });

    expect(page, "notice").not.toContain(escapeHtml(TEXTS.en.telegramActiveNotSetUp));
  });
});
