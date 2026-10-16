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
import { emptyResponse, htmlResponse, renderLoginPage, renderNotConfiguredPage, renderStartPage } from "./pages";
import { createSessionToken, isValidSessionToken, SESSION_COOKIE, SESSION_LIFETIME_MS } from "./session";
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
  readonly csrfValues: readonly string[];
}

/** Which form a page carries or a submission belongs to; a signed-in form names the session its token is bound to. */
type SetupForm = { readonly kind: "login" } | { readonly kind: "start"; readonly session: string };

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

/** The fields of a login or logout body, or the response that ends the request. */
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

async function signedIn(context: Context, session: string, pathname: string): Promise<Response> {
  const { method } = context.request;
  if (method === "GET" && pathname === SETUP_PATH) {
    return formPage(context, { kind: "start", session }, 200);
  }
  if (method === "POST" && pathname === LOGOUT_PATH) {
    return signOut(context, session);
  }
  return plain(context, 404);
}

/** Answers a request under `/setup` as the area document `setup-wizard.md` describes. */
export async function handleSetup(request: Request, pathname: string, deps: SetupDeps): Promise<Response> {
  const { language, fromQuery } = resolveLanguage(request);
  const languageCookies = fromQuery ? [setupCookie(LANGUAGE_COOKIE, language, LANGUAGE_COOKIE_MAX_AGE)] : [];
  const sessionKey = await signingKeyFromEnv(deps.env, "setup-session");
  const csrfKey = await signingKeyFromEnv(deps.env, "setup-csrf");
  if (!isSelunaSecretConfigured(deps.env) || sessionKey === undefined || csrfKey === undefined) {
    return htmlResponse(renderNotConfiguredPage(language), 503, language, languageCookies);
  }
  const csrfValues = cookieValues(request.headers.get("cookie"), CSRF_COOKIE).filter(isWellFormedCsrfCookieValue);
  const context: Context = { request, deps, language, languageCookies, sessionKey, csrfKey, csrfValues };
  if (request.method === "POST" && pathname === LOGIN_PATH) {
    return signIn(context);
  }
  const session = await sessionOf(context);
  return session === undefined ? formPage(context, LOGIN_FORM, 200) : signedIn(context, session, pathname);
}
