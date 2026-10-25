import { MAX_BODY_BYTES, readBodyWithLimit } from "../body";
import { isSelunaSecretConfigured, keyFromEnv, signingKeyFromEnv, verifySelunaSecret } from "../crypto";
import { resetCredentials } from "../store/secrets";
import { writeNotificationSettings } from "../store/settings";
import { clearLoginAttempts, reserveLoginAttempt } from "../store/login-attempts";
import { readSchemaState } from "../store/schema";
import type { GitHubFetch } from "../github/conversion";
import type { TelegramFetch } from "../telegram";
import { cookieValues, setupCookie } from "./cookies";
import {
  CSRF_COOKIE,
  CSRF_FIELD,
  csrfTokenFor,
  isValidCsrfToken,
  isValidSessionCsrfToken,
  isWellFormedCsrfCookieValue,
  newCsrfCookieValue,
  sessionCsrfTokenFor,
} from "./csrf";
import { LANGUAGE_COOKIE, LANGUAGE_COOKIE_MAX_AGE, resolveLanguage } from "./language";
import type { Language } from "./language";
import {
  emptyResponse,
  htmlResponse,
  renderGitHubFinishPage,
  renderGitHubPage,
  renderGitHubReviewPage,
  renderLoginPage,
  renderNotConfiguredPage,
  renderStartPage,
  renderTelegramPage,
} from "./pages";
import type { GitHubPageView, StartPageView, TelegramPageView } from "./pages";
import {
  ACCOUNT_FIELD,
  ACCOUNT_TYPE_FIELD,
  finishGitHubApp,
  GITHUB_CALLBACK_PATH,
  GITHUB_CODE_FIELD,
  GITHUB_STATE_FIELD,
  GITHUB_STEP_PATH,
  gitHubStepView,
  returnFields,
  startGitHubApp,
} from "./github-step";
import { parseSettingsForm, RESET_PATH, SETTINGS_PATH } from "./settings-form";
import { statusView } from "./status";
import { createSessionToken, isValidSessionToken, SESSION_COOKIE, SESSION_LIFETIME_MS } from "./session";
import {
  CHAT_FIELD,
  CODE_FIELD,
  confirmTelegramChat,
  PROOF_FIELD,
  TELEGRAM_STEP_PATH,
  TELEGRAM_VERIFY_PATH,
  telegramStepView,
  verifyTelegramChat,
} from "./telegram-step";
import type { Notice } from "./texts";

/** What the wizard needs from outside. */
export interface SetupDeps {
  /** The Worker environment; `SELUNA_SECRET` is read from it only through `src/crypto.ts`. */
  readonly env: object;
  readonly db: D1Database;
  readonly now: () => Date;
  /** Reaches the Telegram Bot API. */
  readonly fetch: TelegramFetch;
  /** Reaches the GitHub API. */
  readonly githubFetch: GitHubFetch;
  /** The build's version, sent in the GitHub API's User-Agent. */
  readonly version: string;
}

export const SETUP_PATH = "/setup";
export const LOGIN_PATH = "/setup/login";
export const LOGOUT_PATH = "/setup/logout";

/** What one request needs to answer: its language, the language cookie to set, the keys and the clock. */
interface Context {
  readonly request: Request;
  readonly deps: SetupDeps;
  readonly language: Language;
  readonly languageCookies: readonly string[];
  readonly sessionKey: CryptoKey;
  readonly csrfKey: CryptoKey;
  readonly telegramKey: CryptoKey;
  readonly githubKey: CryptoKey;
  /** The AES key of the stored credentials, from `keyFromEnv`. */
  readonly storageKey: CryptoKey;
  readonly csrfValues: readonly string[];
}

/** Which form a page carries or a submission belongs to; a signed-in form names the session its token is bound to. */
type SetupForm =
  | { readonly kind: "login" }
  | { readonly kind: "start"; readonly session: string; readonly view: StartPageView }
  | { readonly kind: "telegram"; readonly session: string; readonly view: TelegramPageView }
  | { readonly kind: "github"; readonly session: string; readonly view: GitHubPageView };

/** Whether `pathname` is `/setup` or starts with `/setup/`. */
export function isSetupPath(pathname: string): boolean {
  return pathname === SETUP_PATH || pathname.startsWith(`${SETUP_PATH}/`);
}

/** The first of the request's (at most four) `seluna_session` values that is a valid session, or `undefined`. */
async function sessionOf(context: Context): Promise<string | undefined> {
  const values = cookieValues(context.request.headers.get("cookie"), SESSION_COOKIE);
  for (const value of values) {
    if (await isValidSessionToken(context.sessionKey, value, context.deps.now())) {
      return value;
    }
  }
  return undefined;
}

/** A page with a form: it takes the request's CSRF cookie value, or draws one and sets the cookie. */
async function formPage(context: Context, form: SetupForm, status: number, notice?: Notice): Promise<Response> {
  const existing = context.csrfValues[0];
  const cookieValue = existing ?? newCsrfCookieValue();
  const cookies = existing === undefined ? [setupCookie(CSRF_COOKIE, cookieValue)] : [];
  let html: string;
  switch (form.kind) {
    case "login":
      html = renderLoginPage(context.language, await csrfTokenFor(context.csrfKey, cookieValue), notice);
      break;
    case "start":
      html = renderStartPage(
        context.language,
        await sessionCsrfTokenFor(context.csrfKey, form.session, cookieValue),
        form.view,
        notice,
      );
      break;
    case "telegram":
      html = renderTelegramPage(
        context.language,
        await sessionCsrfTokenFor(context.csrfKey, form.session, cookieValue),
        form.view,
        notice,
      );
      break;
    case "github":
      html = renderGitHubPage(
        context.language,
        await sessionCsrfTokenFor(context.csrfKey, form.session, cookieValue),
        form.view,
        notice,
      );
      break;
    default: {
      const unreachable: never = form;
      return unreachable;
    }
  }
  return htmlResponse(html, status, context.language, [...context.languageCookies, ...cookies]);
}

function plain(
  context: Context,
  status: number,
  cookies: readonly string[] = [],
  location?: string,
): Promise<Response> {
  return emptyResponse(status, [...context.languageCookies, ...cookies], location);
}

/** The fields of a signed-in or login form body, or the response that ends the request. */
async function readForm(context: Context): Promise<URLSearchParams | Response> {
  const result = await readBodyWithLimit(context.request, MAX_BODY_BYTES);
  switch (result.kind) {
    case "ok":
      return new URLSearchParams(new TextDecoder().decode(result.body));
    case "too-large":
      return plain(context, 413);
    case "unreadable":
      return plain(context, 400);
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

async function hasValidCsrf(context: Context, fields: URLSearchParams, form: SetupForm): Promise<boolean> {
  const tokens = fields.getAll(CSRF_FIELD);
  const [token] = tokens;
  if (tokens.length !== 1) {
    return false;
  }
  switch (form.kind) {
    case "login":
      return isValidCsrfToken(context.csrfKey, token ?? null, context.csrfValues);
    case "start":
    case "telegram":
    case "github":
      return isValidSessionCsrfToken(context.csrfKey, token ?? null, form.session, context.csrfValues);
    default: {
      const unreachable: never = form;
      return unreachable;
    }
  }
}

const LOGIN_FORM: SetupForm = { kind: "login" };

/** The notice of a D1 failure on the login: _migrations missing_ when a schema table is absent, otherwise — also when that check fails — _unavailable_. No error is read. */
async function d1FailureNotice(db: D1Database): Promise<Extract<Notice, "unavailable" | "migrations-missing">> {
  try {
    return (await readSchemaState(db)) === "tables-missing" ? "migrations-missing" : "unavailable";
  } catch {
    // The error is deliberately dropped, as everywhere in the wizard.
    return "unavailable";
  }
}

async function signIn(context: Context): Promise<Response> {
  const form = await readForm(context);
  if (form instanceof Response) {
    return form;
  }
  if (!(await hasValidCsrf(context, form, LOGIN_FORM))) {
    return formPage(context, LOGIN_FORM, 403, "form-expired");
  }
  const { env, db, now } = context.deps;
  try {
    if ((await reserveLoginAttempt(db, now())) === "locked") {
      return await formPage(context, LOGIN_FORM, 429, "locked");
    }
    const candidates = form.getAll("secret");
    const [candidate] = candidates;
    if (candidates.length !== 1 || candidate === undefined || !(await verifySelunaSecret(env, candidate))) {
      return await formPage(context, LOGIN_FORM, 403, "wrong-secret");
    }
    await clearLoginAttempts(db);
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return formPage(context, LOGIN_FORM, 503, await d1FailureNotice(db));
  }
  const token = await createSessionToken(context.sessionKey, now());
  return plain(context, 303, [setupCookie(SESSION_COOKIE, token, SESSION_LIFETIME_MS / 1000)], SETUP_PATH);
}

async function signOut(context: Context, session: string): Promise<Response> {
  const start: SetupForm = { kind: "start", session, view: { kind: "notice-only" } };
  const form = await readForm(context);
  if (form instanceof Response) {
    return form;
  }
  if (!(await hasValidCsrf(context, form, start))) {
    return formPage(context, start, 403, "form-expired");
  }
  return plain(context, 303, [setupCookie(SESSION_COOKIE, "", 0)], SETUP_PATH);
}

/** The Telegram page for `view`, with the session-bound token of a signed-in form. */
function telegramPage(
  context: Context,
  session: string,
  status: number,
  view: TelegramPageView,
  notice?: Notice,
): Promise<Response> {
  return formPage(context, { kind: "telegram", session, view }, status, notice);
}

const NOTICE_ONLY: TelegramPageView = { kind: "notice-only" };
// Placeholder of the skeleton: the token part of a 409 for a confirm or verify form comes with the implementation.
const CHAT_ID_SECRET_VIEW: TelegramPageView = {
  kind: "step",
  token: { kind: "worker-secret", rejected: false },
  chat: { kind: "chat-id-secret" },
};

async function showTelegramStep(context: Context, session: string): Promise<Response> {
  const { env, db, fetch } = context.deps;
  let view: TelegramPageView;
  try {
    view = await telegramStepView(env, db, fetch);
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return telegramPage(context, session, 503, NOTICE_ONLY, "unavailable");
  }
  return telegramPage(context, session, 200, view);
}

/** The fields of a signed-in Telegram form whose CSRF token is valid, or the response that ends the request. */
async function readTelegramForm(context: Context, session: string): Promise<URLSearchParams | Response> {
  const form = await readForm(context);
  if (form instanceof Response) {
    return form;
  }
  if (!(await hasValidCsrf(context, form, { kind: "telegram", session, view: NOTICE_ONLY }))) {
    return telegramPage(context, session, 403, NOTICE_ONLY, "form-expired");
  }
  return form;
}

async function confirmTelegram(context: Context, session: string): Promise<Response> {
  const form = await readTelegramForm(context, session);
  if (form instanceof Response) {
    return form;
  }
  const { env, db, fetch, now } = context.deps;
  const result = await confirmTelegramChat(
    env,
    db,
    fetch,
    context.telegramKey,
    session,
    form.getAll(CHAT_FIELD),
    context.language,
    now(),
  );
  switch (result.kind) {
    case "code-sent":
      return telegramPage(context, session, 200, { kind: "code", chatId: result.chatId, proof: result.proof });
    case "chat-id-secret":
      return telegramPage(context, session, 409, CHAT_ID_SECRET_VIEW);
    case "invalid-chat":
      return telegramPage(context, session, 400, NOTICE_ONLY, "telegram-invalid-chat");
    case "token-missing":
      return telegramPage(context, session, 503, NOTICE_ONLY, "telegram-token-missing");
    case "token-malformed":
      return telegramPage(context, session, 503, NOTICE_ONLY, "telegram-token-malformed");
    case "token-rejected":
      return telegramPage(context, session, 502, NOTICE_ONLY, "telegram-token-rejected");
    case "send-failed":
      return telegramPage(context, session, 502, NOTICE_ONLY, "telegram-send-failed");
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

async function verifyTelegram(context: Context, session: string): Promise<Response> {
  const form = await readTelegramForm(context, session);
  if (form instanceof Response) {
    return form;
  }
  const { env, db, now } = context.deps;
  let result: Awaited<ReturnType<typeof verifyTelegramChat>>;
  try {
    result = await verifyTelegramChat(
      env,
      db,
      context.telegramKey,
      session,
      form.getAll(PROOF_FIELD),
      form.getAll(CODE_FIELD),
      now(),
    );
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return telegramPage(context, session, 503, NOTICE_ONLY, "unavailable");
  }
  switch (result.kind) {
    case "saved":
      return plain(context, 303, [], TELEGRAM_STEP_PATH);
    case "chat-id-secret":
      return telegramPage(context, session, 409, CHAT_ID_SECRET_VIEW);
    case "code-expired":
      return telegramPage(context, session, 400, NOTICE_ONLY, "telegram-code-expired");
    case "wrong-code":
      return telegramPage(
        context,
        session,
        400,
        { kind: "code", chatId: result.chatId, proof: result.proof },
        "telegram-wrong-code",
      );
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

const GITHUB_NOTICE_ONLY: GitHubPageView = { kind: "notice-only" };

/** The GitHub page for `view`, with the session-bound token of a signed-in form. */
function githubPage(
  context: Context,
  session: string,
  status: number,
  view: GitHubPageView,
  notice?: Notice,
): Promise<Response> {
  return formPage(context, { kind: "github", session, view }, status, notice);
}

async function showGitHubStep(context: Context, session: string): Promise<Response> {
  const { env, db } = context.deps;
  let view: GitHubPageView;
  try {
    view = await gitHubStepView(env, db, context.storageKey);
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return githubPage(context, session, 503, GITHUB_NOTICE_ONLY, "unavailable");
  }
  return githubPage(context, session, 200, view);
}

/** The finish page, which carries no session-bound token and sets no cookie but the language cookie. */
function finishPage(context: Context, status: number, code: string, state: string, notice?: Notice): Promise<Response> {
  return htmlResponse(
    renderGitHubFinishPage(context.language, code, state, notice),
    status,
    context.language,
    context.languageCookies,
  );
}

/** A page without a form that only carries `notice`; used where no session-bound token exists. */
function githubNoticePage(context: Context, status: number, notice: Notice): Promise<Response> {
  return htmlResponse(
    renderGitHubPage(context.language, "", GITHUB_NOTICE_ONLY, notice),
    status,
    context.language,
    context.languageCookies,
  );
}

async function startGitHub(context: Context, session: string): Promise<Response> {
  const form = await readForm(context);
  if (form instanceof Response) {
    return form;
  }
  if (!(await hasValidCsrf(context, form, { kind: "github", session, view: GITHUB_NOTICE_ONLY }))) {
    return githubPage(context, session, 403, GITHUB_NOTICE_ONLY, "form-expired");
  }
  const { env, db, now } = context.deps;
  let result: Awaited<ReturnType<typeof startGitHubApp>>;
  let view: GitHubPageView | undefined;
  try {
    result = await startGitHubApp(
      { env, db, storageKey: context.storageKey, stateKey: context.githubKey },
      session,
      new URL(context.request.url).origin,
      form.getAll(ACCOUNT_TYPE_FIELD),
      form.getAll(ACCOUNT_FIELD),
      now(),
    );
    // A refused start shows the step page again, read once more so that it is current.
    view = result.kind === "invalid-account" ? await gitHubStepView(env, db, context.storageKey) : undefined;
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return githubPage(context, session, 503, GITHUB_NOTICE_ONLY, "unavailable");
  }
  switch (result.kind) {
    case "review":
      return htmlResponse(
        renderGitHubReviewPage(context.language, result.choice, result.appName, result.formAction, result.manifest),
        200,
        context.language,
        context.languageCookies,
        "github",
      );
    case "worker-secrets":
    case "partial-worker-secrets":
      return githubPage(context, session, 409, { kind: result.kind });
    case "reset-needed":
      return githubPage(context, session, 409, { kind: "reset-needed" });
    case "invalid-account":
      return githubPage(
        context,
        session,
        400,
        view ?? { kind: "form", savedAppId: undefined },
        "github-invalid-account",
      );
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

/** The finish page for GitHub's return; answered signed in or out, it calls neither GitHub nor D1. */
function showGitHubReturn(context: Context): Promise<Response> {
  const { searchParams } = new URL(context.request.url);
  const fields = returnFields(searchParams.getAll(GITHUB_CODE_FIELD), searchParams.getAll(GITHUB_STATE_FIELD));
  return fields === undefined
    ? githubNoticePage(context, 400, "github-return-invalid")
    : finishPage(context, 200, fields.code, fields.state);
}

async function finishGitHub(context: Context, session: string): Promise<Response> {
  const form = await readForm(context);
  if (form instanceof Response) {
    return form;
  }
  const { env, db, now, githubFetch, version } = context.deps;
  let result: Awaited<ReturnType<typeof finishGitHubApp>>;
  try {
    result = await finishGitHubApp(
      { env, db, storageKey: context.storageKey, stateKey: context.githubKey, fetcher: githubFetch, version },
      session,
      form.getAll(GITHUB_CODE_FIELD),
      form.getAll(GITHUB_STATE_FIELD),
      now(),
    );
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return githubPage(context, session, 503, GITHUB_NOTICE_ONLY, "unavailable");
  }
  switch (result.kind) {
    case "created":
      return githubPage(context, session, 200, { kind: "created", slug: result.slug });
    case "state-invalid":
      return githubPage(context, session, 403, GITHUB_NOTICE_ONLY, "github-state-invalid");
    case "worker-secrets":
    case "partial-worker-secrets":
    case "reset-needed":
      return githubPage(context, session, 409, { kind: result.kind });
    case "return-invalid":
      return githubPage(context, session, 400, GITHUB_NOTICE_ONLY, "github-return-invalid");
    case "code-rejected":
      return githubPage(context, session, 400, GITHUB_NOTICE_ONLY, "github-code-rejected");
    case "github-unavailable":
      return finishPage(context, 502, result.code, result.state, "github-unavailable");
    case "answer-invalid":
      return githubPage(context, session, 502, GITHUB_NOTICE_ONLY, "github-answer-invalid");
    case "owner-mismatch":
      return githubPage(context, session, 403, GITHUB_NOTICE_ONLY, "github-owner-mismatch");
    case "store-failed":
      return githubPage(context, session, 503, GITHUB_NOTICE_ONLY, "github-store-failed");
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

/** The Telegram and GitHub step routes of a signed-in request, or `undefined` for another route. */
function stepRoute(context: Context, session: string, pathname: string): Promise<Response> | undefined {
  const { method } = context.request;
  const routes: Readonly<Record<string, (context: Context, session: string) => Promise<Response>>> = {
    [`GET ${TELEGRAM_STEP_PATH}`]: showTelegramStep,
    [`POST ${TELEGRAM_STEP_PATH}`]: confirmTelegram,
    [`POST ${TELEGRAM_VERIFY_PATH}`]: verifyTelegram,
    [`GET ${GITHUB_STEP_PATH}`]: showGitHubStep,
    [`POST ${GITHUB_STEP_PATH}`]: startGitHub,
    [`POST ${GITHUB_CALLBACK_PATH}`]: finishGitHub,
  };
  return Object.hasOwn(routes, `${method} ${pathname}`)
    ? routes[`${method} ${pathname}`]?.(context, session)
    : undefined;
}

const START_NOTICE_ONLY: StartPageView = { kind: "notice-only" };

/** The start page with the status view at `status`; a D1 failure answers 503 with the notice-only page. */
async function startPage(context: Context, session: string, status: number, notice?: Notice): Promise<Response> {
  const { env, db, version, githubFetch, now } = context.deps;
  let view: StartPageView;
  try {
    view = {
      kind: "status",
      status: await statusView(env, db, context.storageKey, version, { fetcher: githubFetch, now }),
    };
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return formPage(context, { kind: "start", session, view: START_NOTICE_ONLY }, 503, "unavailable");
  }
  return formPage(context, { kind: "start", session, view }, status, notice);
}

/** The fields of a signed-in start page form whose CSRF token is valid, or the response that ends the request. */
async function readStartForm(context: Context, session: string): Promise<URLSearchParams | Response> {
  const form = await readForm(context);
  if (form instanceof Response) {
    return form;
  }
  const start: SetupForm = { kind: "start", session, view: START_NOTICE_ONLY };
  return (await hasValidCsrf(context, form, start)) ? form : formPage(context, start, 403, "form-expired");
}

async function saveSettings(context: Context, session: string): Promise<Response> {
  const form = await readStartForm(context, session);
  if (form instanceof Response) {
    return form;
  }
  const settings = parseSettingsForm(form);
  if (settings === undefined) {
    return startPage(context, session, 400, "settings-invalid");
  }
  try {
    await writeNotificationSettings(context.deps.db, settings);
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return formPage(context, { kind: "start", session, view: START_NOTICE_ONLY }, 503, "unavailable");
  }
  return plain(context, 303, [], SETUP_PATH);
}

async function resetSaved(context: Context, session: string): Promise<Response> {
  const form = await readStartForm(context, session);
  if (form instanceof Response) {
    return form;
  }
  let result: Awaited<ReturnType<typeof resetCredentials>>;
  try {
    result = await resetCredentials(context.deps.db, context.storageKey);
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return formPage(context, { kind: "start", session, view: START_NOTICE_ONLY }, 503, "unavailable");
  }
  switch (result) {
    case "reset":
      return plain(context, 303, [], GITHUB_STEP_PATH);
    case "not-needed":
      return startPage(context, session, 409, "reset-not-needed");
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

async function signedIn(context: Context, session: string, pathname: string): Promise<Response> {
  const { method } = context.request;
  if (method === "GET" && pathname === SETUP_PATH) {
    return startPage(context, session, 200);
  }
  if (method === "POST" && pathname === SETTINGS_PATH) {
    return saveSettings(context, session);
  }
  if (method === "POST" && pathname === RESET_PATH) {
    return resetSaved(context, session);
  }
  if (method === "POST" && pathname === LOGOUT_PATH) {
    return signOut(context, session);
  }
  return stepRoute(context, session, pathname) ?? plain(context, 404);
}

/** The keys every request under `/setup` needs, or `undefined` when `SELUNA_SECRET` is not configured. */
type SetupKeys = Pick<Context, "sessionKey" | "csrfKey" | "telegramKey" | "githubKey" | "storageKey">;

async function setupKeys(env: object): Promise<SetupKeys | undefined> {
  const keys = {
    sessionKey: await signingKeyFromEnv(env, "setup-session"),
    csrfKey: await signingKeyFromEnv(env, "setup-csrf"),
    telegramKey: await signingKeyFromEnv(env, "setup-telegram"),
    githubKey: await signingKeyFromEnv(env, "setup-github"),
    storageKey: await keyFromEnv(env),
  };
  const { sessionKey, csrfKey, telegramKey, githubKey, storageKey } = keys;
  // All keys derive from the same secret, so they exist together; the checks only narrow the types.
  return isSelunaSecretConfigured(env) &&
    sessionKey !== undefined &&
    csrfKey !== undefined &&
    telegramKey !== undefined &&
    githubKey !== undefined &&
    storageKey !== undefined
    ? { sessionKey, csrfKey, telegramKey, githubKey, storageKey }
    : undefined;
}

/** Answers a request under `/setup` as the area document `setup-wizard.md` describes. */
export async function handleSetup(request: Request, pathname: string, deps: SetupDeps): Promise<Response> {
  const { language, fromQuery } = resolveLanguage(request);
  const languageCookies = fromQuery ? [setupCookie(LANGUAGE_COOKIE, language, LANGUAGE_COOKIE_MAX_AGE)] : [];
  const keys = await setupKeys(deps.env);
  if (keys === undefined) {
    return htmlResponse(renderNotConfiguredPage(language), 503, language, languageCookies);
  }
  const csrfValues = cookieValues(request.headers.get("cookie"), CSRF_COOKIE).filter(isWellFormedCsrfCookieValue);
  const context: Context = { request, deps, language, languageCookies, ...keys, csrfValues };
  if (request.method === "POST" && pathname === LOGIN_PATH) {
    return signIn(context);
  }
  if (request.method === "GET" && pathname === GITHUB_CALLBACK_PATH) {
    return showGitHubReturn(context);
  }
  const session = await sessionOf(context);
  return session === undefined ? formPage(context, LOGIN_FORM, 200) : signedIn(context, session, pathname);
}
