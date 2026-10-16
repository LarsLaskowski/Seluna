import { MAX_BODY_BYTES, readBodyWithLimit } from "../body";
import { isSelunaSecretConfigured, signingKeyFromEnv, verifySelunaSecret } from "../crypto";
import { clearLoginAttempts, reserveLoginAttempt } from "../store/login-attempts";
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
  renderLoginPage,
  renderNotConfiguredPage,
  renderStartPage,
  renderTelegramPage,
} from "./pages";
import type { TelegramPageView } from "./pages";
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
  readonly csrfValues: readonly string[];
}

/** Which form a page carries or a submission belongs to; a signed-in form names the session its token is bound to. */
type SetupForm =
  | { readonly kind: "login" }
  | { readonly kind: "start"; readonly session: string }
  | { readonly kind: "telegram"; readonly session: string; readonly view: TelegramPageView };

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
      return isValidSessionCsrfToken(context.csrfKey, token ?? null, form.session, context.csrfValues);
    default: {
      const unreachable: never = form;
      return unreachable;
    }
  }
}

const LOGIN_FORM: SetupForm = { kind: "login" };

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
    return formPage(context, LOGIN_FORM, 503, "unavailable");
  }
  const token = await createSessionToken(context.sessionKey, now());
  return plain(context, 303, [setupCookie(SESSION_COOKIE, token, SESSION_LIFETIME_MS / 1000)], SETUP_PATH);
}

async function signOut(context: Context, session: string): Promise<Response> {
  const start: SetupForm = { kind: "start", session };
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
  const { env, fetch, now } = context.deps;
  const result = await confirmTelegramChat(
    env,
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
      return telegramPage(context, session, 409, { kind: "chat-id-secret" });
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
      return telegramPage(context, session, 409, { kind: "chat-id-secret" });
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

async function signedIn(context: Context, session: string, pathname: string): Promise<Response> {
  const { method } = context.request;
  if (method === "GET" && pathname === SETUP_PATH) {
    return formPage(context, { kind: "start", session }, 200);
  }
  if (method === "POST" && pathname === LOGOUT_PATH) {
    return signOut(context, session);
  }
  if (pathname === TELEGRAM_STEP_PATH) {
    if (method === "GET") {
      return showTelegramStep(context, session);
    }
    if (method === "POST") {
      return confirmTelegram(context, session);
    }
  }
  if (method === "POST" && pathname === TELEGRAM_VERIFY_PATH) {
    return verifyTelegram(context, session);
  }
  return plain(context, 404);
}

/** Answers a request under `/setup` as the area document `setup-wizard.md` describes. */
export async function handleSetup(request: Request, pathname: string, deps: SetupDeps): Promise<Response> {
  const { language, fromQuery } = resolveLanguage(request);
  const languageCookies = fromQuery ? [setupCookie(LANGUAGE_COOKIE, language, LANGUAGE_COOKIE_MAX_AGE)] : [];
  const sessionKey = await signingKeyFromEnv(deps.env, "setup-session");
  const csrfKey = await signingKeyFromEnv(deps.env, "setup-csrf");
  const telegramKey = await signingKeyFromEnv(deps.env, "setup-telegram");
  if (
    !isSelunaSecretConfigured(deps.env) ||
    sessionKey === undefined ||
    csrfKey === undefined ||
    telegramKey === undefined
  ) {
    return htmlResponse(renderNotConfiguredPage(language), 503, language, languageCookies);
  }
  const csrfValues = cookieValues(request.headers.get("cookie"), CSRF_COOKIE).filter(isWellFormedCsrfCookieValue);
  const context: Context = { request, deps, language, languageCookies, sessionKey, csrfKey, telegramKey, csrfValues };
  if (request.method === "POST" && pathname === LOGIN_PATH) {
    return signIn(context);
  }
  const session = await sessionOf(context);
  return session === undefined ? formPage(context, LOGIN_FORM, 200) : signedIn(context, session, pathname);
}
