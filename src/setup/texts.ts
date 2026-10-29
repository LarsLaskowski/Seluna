import type { RuleId } from "../settings";
import type { Language } from "./language";

export type Notice =
  | "wrong-secret"
  | "locked"
  | "form-expired"
  | "unavailable"
  | "migrations-missing"
  | "telegram-token-missing"
  | "telegram-token-malformed"
  | "telegram-token-rejected"
  | "telegram-token-invalid"
  | "telegram-token-not-accepted"
  | "telegram-token-unverified"
  | "telegram-saved-token-rejected"
  | "telegram-token-unreadable"
  | "telegram-token-damaged"
  | "telegram-token-not-saved"
  | "telegram-conflict"
  | "telegram-unavailable"
  | "telegram-send-failed"
  | "telegram-invalid-chat"
  | "telegram-wrong-code"
  | "telegram-code-expired"
  | "github-invalid-account"
  | "github-return-invalid"
  | "github-state-invalid"
  | "github-code-rejected"
  | "github-unavailable"
  | "github-answer-invalid"
  | "github-owner-mismatch"
  | "github-store-failed"
  | "settings-invalid"
  | "reset-not-needed"
  | "messenger-invalid"
  | "messenger-not-set-up"
  | "messenger-worker-secrets";

export interface SetupTexts {
  readonly pageTitle: string;
  readonly languageLabel: string;
  /** The accessible name of the step navigation. */
  readonly stepsLabel: string;
  /** The label of the step navigation's start page item. */
  readonly startPageLink: string;
  readonly loginHeading: string;
  readonly loginIntro: string;
  readonly secretLabel: string;
  readonly loginButton: string;
  readonly startHeading: string;
  readonly startBody: string;
  readonly logoutButton: string;
  readonly telegramHeading: string;
  readonly telegramTokenHeading: string;
  readonly telegramChatHeading: string;
  readonly telegramTokenIntro: string;
  readonly telegramTokenLabel: string;
  readonly telegramTokenSaveButton: string;
  readonly telegramTokenSaved: string;
  readonly telegramTokenChange: string;
  readonly telegramTokenRemoveButton: string;
  readonly telegramTokenWorkerSecret: string;
  readonly telegramIntro: string;
  readonly telegramSearchLink: string;
  readonly telegramChatIdSecret: string;
  readonly telegramSavedChat: string;
  readonly telegramNoSavedChat: string;
  readonly telegramChatsIntro: string;
  readonly telegramNoChats: string;
  readonly telegramPrivateChat: string;
  readonly telegramGroup: string;
  readonly telegramConfirmButton: string;
  readonly telegramTestMessage: string;
  readonly telegramCodeSent: string;
  readonly telegramCodeIntro: string;
  readonly telegramCodeLabel: string;
  readonly telegramCodeButton: string;
  readonly githubHeading: string;
  readonly githubIntro: string;
  readonly githubWorkerSecrets: string;
  readonly githubPartialWorkerSecrets: string;
  readonly githubResetNeeded: string;
  readonly githubSavedApp: string;
  readonly githubNoSavedApp: string;
  readonly githubReplaceHint: string;
  readonly githubPersonal: string;
  readonly githubOrganization: string;
  readonly githubAccountLabel: string;
  readonly githubNextButton: string;
  readonly githubReviewIntro: string;
  readonly githubReviewAccountLabel: string;
  readonly githubAppNameLabel: string;
  readonly githubPermissionsLabel: string;
  readonly githubPermissionsList: string;
  readonly githubEventsLabel: string;
  readonly githubEventsList: string;
  readonly githubToGitHubButton: string;
  readonly githubFinishIntro: string;
  readonly githubFinishButton: string;
  readonly githubCreated: string;
  readonly githubInstallIntro: string;
  readonly githubInstallLink: string;
  readonly githubInstallManual: string;
  readonly githubBackLink: string;
  readonly statusHeading: string;
  readonly versionLabel: string;
  readonly botTokenLabel: string;
  readonly botTokenSecret: string;
  readonly botTokenSaved: string;
  readonly telegramChatLabel: string;
  readonly noneSavedYet: string;
  readonly chatSecret: string;
  readonly githubAppLabel: string;
  readonly appSecrets: string;
  readonly appPartial: string;
  readonly appIdLabel: string;
  readonly cannotBeRead: string;
  readonly lastDeliveryLabel: string;
  readonly noneReceivedYet: string;
  readonly installationsLabel: string;
  readonly accountPersonal: string;
  readonly accountOrganization: string;
  readonly accountOther: string;
  readonly accountEnterprise: string;
  readonly unknownAccount: string;
  readonly repositoriesAll: string;
  readonly repositoriesSelected: string;
  readonly installationSuspended: string;
  readonly notInstalled: string;
  readonly moreInstallations: string;
  readonly installationsUnavailable: string;
  readonly keyUnusable: string;
  readonly ownerLabel: string;
  readonly ownerUnavailable: string;
  readonly ownerOrganizationNotice: string;
  readonly appMissingLabel: string;
  readonly appUnchecked: string;
  readonly appSettingsLink: string;
  readonly readOnlySuffix: string;
  readonly eventsLabel: string;
  readonly installationMissing: string;
  readonly installationReviewLink: string;
  readonly accessNotChecked: string;
  readonly resetHeading: string;
  readonly resetText: string;
  readonly resetButton: string;
  readonly settingsHeading: string;
  readonly notificationLanguageLabel: string;
  readonly timeZoneLabel: string;
  readonly quietHoursLabel: string;
  readonly quietStartLabel: string;
  readonly quietEndLabel: string;
  readonly rulesLabel: string;
  readonly updateNoticeLabel: string;
  readonly saveSettingsButton: string;
  readonly ruleLabels: Readonly<Record<RuleId, string>>;
  readonly notConfiguredHeading: string;
  readonly notConfiguredParagraphs: readonly string[];
  readonly messengersHeading: string;
  readonly messengersIntro: string;
  readonly messengerStateNotSetUp: string;
  readonly messengerStateSetUp: string;
  readonly messengerStateActive: string;
  readonly messengerActiveNotSetUp: string;
  readonly messengerSetUpLink: string;
  readonly messengerChangeLink: string;
  readonly messengerActivateButton: string;
  readonly messengerRemoveButton: string;
  readonly messengerLabel: string;
  readonly messengerNotSetUpSuffix: string;
  readonly telegramActiveNotSetUp: string;
  readonly notices: Readonly<Record<Notice, string>>;
}

const ENGLISH: SetupTexts = {
  pageTitle: "Seluna setup",
  languageLabel: "Language",
  stepsLabel: "Setup steps",
  startPageLink: "Start page",
  loginHeading: "Sign in",
  loginIntro: "Enter the SELUNA_SECRET of this instance to open the setup.",
  secretLabel: "SELUNA_SECRET",
  loginButton: "Sign in",
  startHeading: "You are signed in",
  startBody: "Set up your instance step by step:",
  logoutButton: "Sign out",
  telegramHeading: "Telegram chat",
  telegramTokenHeading: "Bot token",
  telegramChatHeading: "Chat",
  telegramTokenIntro:
    "Seluna sends its notifications through your own Telegram bot. In Telegram, send /newbot to @BotFather and enter the token it returns here. Seluna checks the token with Telegram and saves it encrypted; it is not shown again.",
  telegramTokenLabel: "Bot token",
  telegramTokenSaveButton: "Save token",
  telegramTokenSaved: "A bot token is saved. It is not shown again.",
  telegramTokenChange: "Change token",
  telegramTokenRemoveButton: "Remove token",
  telegramTokenWorkerSecret:
    "The bot token is set by the Worker secret TELEGRAM_BOT_TOKEN, which takes precedence over a token saved here. To enter the token here, delete that secret.",
  telegramIntro:
    "Seluna sends its notifications to one Telegram chat. Open your bot in Telegram and send /start, or add the bot to a group. Then search for chats.",
  telegramSearchLink: "Search for chats",
  telegramChatIdSecret:
    "The chat is set by the Worker secret TELEGRAM_CHAT_ID, which takes precedence over a chat chosen here. To choose the chat here, delete that secret.",
  telegramSavedChat: "Saved chat:",
  telegramNoSavedChat: "No chat is saved yet.",
  telegramChatsIntro:
    "Chats your bot has seen recently. Anyone who messages your bot appears here, so choose only your own chat: Seluna sends a test message with a code to it, and the chat is saved once you enter that code.",
  telegramNoChats:
    "No chat found. Send /start to your bot or add it to a group, then search again. Telegram keeps messages to the bot for 24 hours, and Seluna sees only the newest 100: if your bot receives many messages, send /start again just before you search.",
  telegramPrivateChat: "Private chat",
  telegramGroup: "Group",
  telegramConfirmButton: "Send test message",
  telegramTestMessage:
    "Seluna setup: to send the notifications of your instance to this chat, enter this code on your setup page. If you did not ask for it, ignore this message. Code:",
  telegramCodeSent: "Test message sent to chat:",
  telegramCodeIntro:
    "Enter the six-digit code from that message to save the chat. If no message arrived, the chat is not yours: search again and choose another.",
  telegramCodeLabel: "Code",
  telegramCodeButton: "Save chat",
  githubHeading: "GitHub App",
  githubIntro:
    "Seluna receives the events of your repositories through a private GitHub App of its own. Create it here for your personal account or for an organization: Seluna sends GitHub a manifest with the app's name, the webhook address of this instance and read-only permissions, and saves the app's credentials encrypted once you have confirmed on GitHub.",
  githubWorkerSecrets:
    "The GitHub App is set by the Worker secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET, which take precedence over an app created here. To create the app here, delete those secrets.",
  githubPartialWorkerSecrets:
    "Some, but not all, of the Worker secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are set. Set all three to configure the app by hand, or delete them to create the app here.",
  githubResetNeeded:
    "The saved GitHub credentials cannot be read with the current SELUNA_SECRET: it was changed, or the saved values are damaged. Set the earlier SELUNA_SECRET again, or reset the saved credentials on the start page and create the app again.",
  githubSavedApp: "Saved GitHub App, App ID:",
  githubNoSavedApp: "No GitHub App is saved yet.",
  githubReplaceHint:
    "Creating a new app replaces the saved one. Delete the old app on GitHub afterwards: in the settings of your account or organization, under Developer settings, then GitHub Apps.",
  githubPersonal: "My personal account",
  githubOrganization: "An organization",
  githubAccountLabel: "Name of the account or organization, as in github.com/name",
  githubNextButton: "Next",
  githubReviewIntro:
    "Seluna asks GitHub to create this app. On GitHub, check the details and select Create GitHub App; GitHub then sends you back here. Seluna saves the app only if GitHub created it for the account shown here.",
  githubReviewAccountLabel: "Account:",
  githubAppNameLabel: "App name:",
  githubPermissionsLabel: "Permissions, all read-only:",
  githubPermissionsList:
    "Actions, Contents, Issues, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts, Metadata",
  githubEventsLabel: "Events:",
  githubEventsList:
    "Pull request, Workflow run, Dependabot alert, Code scanning alert, Secret scanning alert, Issues, Issue comment, Fork, Star",
  githubToGitHubButton: "Continue to GitHub",
  githubFinishIntro: "GitHub has created the app. Select Finish so that Seluna fetches and saves its credentials.",
  githubFinishButton: "Finish",
  githubCreated: "The GitHub App is saved.",
  githubInstallIntro:
    "Now install it on your account or organization. Choosing Only select repositories is recommended: Seluna then sees only the repositories you pick, and you add a new repository to the installation by hand.",
  githubInstallLink: "Install the app on GitHub",
  githubInstallManual:
    "Install it on GitHub: in the settings of your account or organization, open Developer settings, then GitHub Apps, choose the app and select Install App. Choosing Only select repositories is recommended: Seluna then sees only the repositories you pick, and you add a new repository to the installation by hand.",
  githubBackLink: "Back to the GitHub App step",
  statusHeading: "Status",
  versionLabel: "Version:",
  botTokenLabel: "Telegram bot token:",
  botTokenSecret: "Set by the Worker secret TELEGRAM_BOT_TOKEN.",
  botTokenSaved: "Saved in the setup.",
  telegramChatLabel: "Telegram chat:",
  noneSavedYet: "None saved yet.",
  chatSecret: "Set by the Worker secret TELEGRAM_CHAT_ID.",
  githubAppLabel: "GitHub App:",
  appSecrets: "Set by the Worker secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET.",
  appPartial:
    "Only some of the Worker secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are set.",
  appIdLabel: "App ID",
  cannotBeRead: "Cannot be read with the current SELUNA_SECRET.",
  lastDeliveryLabel: "Last delivery from GitHub:",
  noneReceivedYet: "None received yet.",
  installationsLabel: "Installations:",
  accountPersonal: "personal account",
  accountOrganization: "organization",
  accountOther: "other account",
  accountEnterprise: "enterprise",
  unknownAccount: "Unknown account",
  repositoriesAll: "all repositories",
  repositoriesSelected: "selected repositories",
  installationSuspended: "suspended",
  notInstalled: "Not installed on any account yet.",
  moreInstallations: "Only the first 100 installations are shown.",
  installationsUnavailable: "Cannot be loaded from GitHub right now.",
  keyUnusable: "The app's private key cannot be used.",
  ownerLabel: "GitHub App owner:",
  ownerUnavailable: "Cannot be read from GitHub right now.",
  ownerOrganizationNotice:
    "The app belongs to an organization, so Seluna cannot tell your own actions from anyone else's: activity of every account is reported, yours too.",
  appMissingLabel: "Missing on the app:",
  appUnchecked: "Seluna could not read the app's permissions from GitHub.",
  appSettingsLink: "Add them in the app's settings on GitHub",
  readOnlySuffix: "read-only",
  eventsLabel: "events:",
  installationMissing: "missing:",
  installationReviewLink: "Review and accept on GitHub",
  accessNotChecked: "access not checked",
  resetHeading: "The saved credentials cannot be read",
  resetText:
    "The saved credentials cannot be read with the current SELUNA_SECRET: it was changed, or a saved value is damaged. If you still know the earlier SELUNA_SECRET, set it again instead. Otherwise reset: Seluna deletes the saved GitHub credentials, the installation tokens and the saved Telegram bot token; you then create the GitHub App again and enter the bot token again in the Telegram chat step. Delete the old app on GitHub afterwards: in the settings of your account or organization, under Developer settings, then GitHub Apps. The Telegram chat and the settings are kept.",
  resetButton: "Reset and create the GitHub App again",
  settingsHeading: "Settings",
  notificationLanguageLabel: "Language of the notifications",
  timeZoneLabel: "Time zone",
  quietHoursLabel: "Quiet hours: notifications arrive without sound",
  quietStartLabel: "Start",
  quietEndLabel: "End",
  rulesLabel: "Notify me about",
  updateNoticeLabel: "Tell me when a new Seluna release is available",
  saveSettingsButton: "Save settings",
  ruleLabels: {
    pull_request_opened: "New pull request",
    pull_request_ready_for_review: "Pull request ready for review",
    pull_request_review_requested: "Review requested",
    ci_failed_default_branch: "CI failed on the default branch",
    ci_failed_pull_request: "CI failed in a pull request",
    dependabot_alert: "Dependabot alert",
    code_scanning_alert: "Code scanning alert",
    secret_scanning_alert: "Secret scanning alert",
  },
  notConfiguredHeading: "SELUNA_SECRET is not set",
  notConfiguredParagraphs: [
    "The setup cannot start because the Worker secret SELUNA_SECRET is missing or shorter than 32 characters.",
    "Create a random string of at least 32 characters, for example with a password manager or with: openssl rand -hex 32",
    "In the Cloudflare dashboard open this Worker, then Settings, then Variables and Secrets, and add a secret named SELUNA_SECRET with that string. Or run: npx wrangler secret put SELUNA_SECRET",
    "Then reload this page.",
  ],
  messengersHeading: "Messengers",
  messengersIntro:
    "Seluna sends its notifications through one messenger, the active one. Set up a messenger, then activate it; notifications still waiting are then sent through it.",
  messengerStateNotSetUp: "Not set up",
  messengerStateSetUp: "Set up",
  messengerStateActive: "Active",
  messengerActiveNotSetUp: "Active, but not set up: notifications wait until it is set up.",
  messengerSetUpLink: "Set up",
  messengerChangeLink: "Change",
  messengerActivateButton: "Activate",
  messengerRemoveButton: "Remove",
  messengerLabel: "Messenger:",
  messengerNotSetUpSuffix: "(not set up)",
  telegramActiveNotSetUp:
    "Telegram is the active messenger: notifications wait until a bot token and a chat are set up here.",
  notices: {
    "messenger-invalid": "Please choose a messenger from the list.",
    "messenger-not-set-up": "This messenger is not set up yet. Set it up first, then activate it.",
    "messenger-worker-secrets":
      "This messenger is set by Worker secrets, which Seluna cannot remove. Delete them in the Cloudflare dashboard under Settings, then Variables and Secrets.",
    "wrong-secret": "That is not the SELUNA_SECRET of this instance.",
    locked:
      "Too many failed attempts. Signing in is locked for 15 minutes after the fifth failed attempt; try again later.",
    "form-expired": "The form has expired. Please submit it again.",
    unavailable: "The setup is unavailable right now. Please try again in a moment.",
    "migrations-missing":
      "The database of this instance is missing its tables: the database migrations have not run. In the Cloudflare dashboard open Workers & Pages, this Worker, Settings and Build, set the Deploy command to npm run deploy and retry the latest build, as the setup guide describes.",
    "telegram-token-missing":
      "No usable bot token is available. Open the Telegram chat step and check the bot token there.",
    "telegram-token-malformed":
      "The Worker secret TELEGRAM_BOT_TOKEN is not a bot token. A token from @BotFather is digits, a colon, then letters, digits, - and _, without spaces. Copy it again from @BotFather and replace the secret in the Cloudflare dashboard under Settings, then Variables and Secrets.",
    "telegram-token-rejected":
      "Telegram does not accept the Worker secret TELEGRAM_BOT_TOKEN: it is mistyped or was revoked. Send /mybots to @BotFather, copy your bot's current token and replace the secret in the Cloudflare dashboard under Settings, then Variables and Secrets.",
    "telegram-token-invalid":
      "That is not a bot token. A token from @BotFather is digits, a colon, then letters, digits, - and _, without spaces. Copy it again from @BotFather. Nothing was saved.",
    "telegram-token-not-accepted":
      "Telegram does not accept this token: it is mistyped or was revoked. Send /mybots to @BotFather, copy your bot's current token and enter it again. Nothing was saved.",
    "telegram-token-unverified":
      "Telegram could not be reached or gave an answer Seluna cannot read, so the token was not saved. Please try again in a moment.",
    "telegram-saved-token-rejected":
      "Telegram does not accept the saved bot token: it was revoked or the bot was deleted. Send /mybots to @BotFather, copy your bot's current token and enter it here.",
    "telegram-token-unreadable":
      "The saved bot token cannot be read with the current SELUNA_SECRET: it was changed, or the saved values are damaged. Set the earlier SELUNA_SECRET again, or reset the saved credentials on the start page and enter the token again.",
    "telegram-token-damaged": "The saved bot token is damaged and cannot be read. Enter the token again, or remove it.",
    "telegram-token-not-saved":
      "The token was not saved because the saved credentials cannot be read with the current SELUNA_SECRET. Set the earlier SELUNA_SECRET again, or reset the saved credentials on the start page first.",
    "telegram-conflict":
      "Telegram does not hand the bot's chats to Seluna because another program receives its updates (a webhook, or a program that polls the bot). Seluna needs a bot of its own: create one with /newbot at @BotFather, or remove the webhook from this bot.",
    "telegram-unavailable":
      "Telegram could not be reached or gave an answer Seluna cannot read. Please try again in a moment.",
    "telegram-send-failed":
      "The test message could not be sent, so the chat was not saved. Check that the bot is still in the chat and not blocked, then search again.",
    "telegram-invalid-chat": "Please choose a chat from the list.",
    "telegram-wrong-code": "The code does not match the test message. Check the code in your chat and enter it again.",
    "telegram-code-expired":
      "The code has expired or the form is no longer valid. Search for chats again and send a new test message.",
    "github-invalid-account":
      "Choose your personal account or an organization and enter its name: 1 to 39 letters, digits and hyphens, not starting or ending with a hyphen.",
    "github-return-invalid":
      "This page needs the code and state GitHub sends back after creating the app. Start again from the GitHub App step.",
    "github-state-invalid":
      "This return from GitHub does not belong to your current sign-in or is older than one hour, so nothing was saved. If GitHub created an app, delete it on GitHub and start again.",
    "github-code-rejected":
      "GitHub no longer accepts this return: the code was already used or is older than one hour. Open the GitHub App step and compare the App ID saved there with the one GitHub shows in the app's settings: if they match, the app is saved; otherwise delete the app on GitHub and start again.",
    "github-unavailable":
      "GitHub could not be reached. Select Finish again in a moment; the return stays valid for one hour.",
    "github-answer-invalid":
      "GitHub created the app, but its answer could not be read, so nothing was saved. Delete the app on GitHub and start again.",
    "github-owner-mismatch":
      "This app does not belong to the account you chose in Seluna, so nothing was saved. If you created it yourself, delete it on GitHub and start again with the name of the account you are signed in to on GitHub, or of the organization.",
    "github-store-failed":
      "GitHub created the app, but saving its credentials failed, so nothing was saved. Delete the app on GitHub and start again.",
    "settings-invalid":
      "The settings were not saved. Check the values: quiet hours need a start and an end in the form 22:00, and the two must differ.",
    "reset-not-needed": "The saved credentials can be read with the current SELUNA_SECRET, so nothing was reset.",
  },
};

const GERMAN: SetupTexts = {
  pageTitle: "Seluna-Einrichtung",
  languageLabel: "Sprache",
  stepsLabel: "Einrichtungsschritte",
  startPageLink: "Startseite",
  loginHeading: "Anmelden",
  loginIntro: "Gib das SELUNA_SECRET dieser Instanz ein, um die Einrichtung zu öffnen.",
  secretLabel: "SELUNA_SECRET",
  loginButton: "Anmelden",
  startHeading: "Du bist angemeldet",
  startBody: "Richte deine Instanz Schritt für Schritt ein:",
  logoutButton: "Abmelden",
  telegramHeading: "Telegram-Chat",
  telegramTokenHeading: "Bot-Token",
  telegramChatHeading: "Chat",
  telegramTokenIntro:
    "Seluna sendet seine Benachrichtigungen über deinen eigenen Telegram-Bot. Sende in Telegram /newbot an @BotFather und gib den zurückgegebenen Token hier ein. Seluna prüft den Token bei Telegram und speichert ihn verschlüsselt; er wird nicht wieder angezeigt.",
  telegramTokenLabel: "Bot-Token",
  telegramTokenSaveButton: "Token speichern",
  telegramTokenSaved: "Ein Bot-Token ist gespeichert. Er wird nicht wieder angezeigt.",
  telegramTokenChange: "Token ändern",
  telegramTokenRemoveButton: "Token entfernen",
  telegramTokenWorkerSecret:
    "Der Bot-Token wird durch das Worker-Secret TELEGRAM_BOT_TOKEN festgelegt, das Vorrang vor einem hier gespeicherten Token hat. Um den Token hier einzugeben, lösche dieses Secret.",
  telegramIntro:
    "Seluna sendet seine Benachrichtigungen an einen Telegram-Chat. Öffne deinen Bot in Telegram und sende /start, oder füge den Bot einer Gruppe hinzu. Suche danach nach Chats.",
  telegramSearchLink: "Nach Chats suchen",
  telegramChatIdSecret:
    "Der Chat wird durch das Worker-Secret TELEGRAM_CHAT_ID festgelegt, das Vorrang vor einem hier gewählten Chat hat. Um den Chat hier zu wählen, lösche dieses Secret.",
  telegramSavedChat: "Gespeicherter Chat:",
  telegramNoSavedChat: "Es ist noch kein Chat gespeichert.",
  telegramChatsIntro:
    "Chats, die dein Bot kürzlich gesehen hat. Jeder, der deinem Bot schreibt, erscheint hier. Wähle deshalb nur deinen eigenen Chat: Seluna sendet eine Testnachricht mit einem Code dorthin, und der Chat wird gespeichert, sobald du diesen Code eingibst.",
  telegramNoChats:
    "Kein Chat gefunden. Sende deinem Bot /start oder füge ihn einer Gruppe hinzu und suche dann erneut. Telegram hält Nachrichten an den Bot 24 Stunden vor, und Seluna sieht nur die neuesten 100: Wenn dein Bot viele Nachrichten erhält, sende kurz vor der Suche erneut /start.",
  telegramPrivateChat: "Privatchat",
  telegramGroup: "Gruppe",
  telegramConfirmButton: "Testnachricht senden",
  telegramTestMessage:
    "Seluna-Einrichtung: Um die Benachrichtigungen deiner Instanz an diesen Chat zu senden, gib diesen Code auf deiner Einrichtungsseite ein. Wenn du ihn nicht angefordert hast, ignoriere diese Nachricht. Code:",
  telegramCodeSent: "Testnachricht gesendet an Chat:",
  telegramCodeIntro:
    "Gib den sechsstelligen Code aus dieser Nachricht ein, um den Chat zu speichern. Ist keine Nachricht angekommen, ist der Chat nicht deiner: Suche erneut und wähle einen anderen.",
  telegramCodeLabel: "Code",
  telegramCodeButton: "Chat speichern",
  githubHeading: "GitHub-App",
  githubIntro:
    "Seluna empfängt die Ereignisse deiner Repositories über eine eigene, private GitHub-App. Erstelle sie hier für dein persönliches Konto oder für eine Organisation: Seluna sendet GitHub ein Manifest mit dem Namen der App, der Webhook-Adresse dieser Instanz und reinen Leserechten und speichert die Zugangsdaten der App verschlüsselt, sobald du auf GitHub bestätigt hast.",
  githubWorkerSecrets:
    "Die GitHub-App wird durch die Worker-Secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY und GITHUB_WEBHOOK_SECRET festgelegt, die Vorrang vor einer hier erstellten App haben. Um die App hier zu erstellen, lösche diese Secrets.",
  githubPartialWorkerSecrets:
    "Einige, aber nicht alle der Worker-Secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY und GITHUB_WEBHOOK_SECRET sind gesetzt. Setze alle drei, um die App von Hand zu konfigurieren, oder lösche sie, um die App hier zu erstellen.",
  githubResetNeeded:
    "Die gespeicherten GitHub-Zugangsdaten lassen sich mit dem aktuellen SELUNA_SECRET nicht lesen: Es wurde geändert, oder die gespeicherten Werte sind beschädigt. Setze das frühere SELUNA_SECRET wieder, oder setze die gespeicherten Zugangsdaten auf der Startseite zurück und erstelle die App danach erneut.",
  githubSavedApp: "Gespeicherte GitHub-App, App-ID:",
  githubNoSavedApp: "Es ist noch keine GitHub-App gespeichert.",
  githubReplaceHint:
    "Eine neue App ersetzt die gespeicherte. Lösche die alte App danach auf GitHub: in den Einstellungen deines Kontos oder deiner Organisation unter Developer settings, dann GitHub Apps.",
  githubPersonal: "Mein persönliches Konto",
  githubOrganization: "Eine Organisation",
  githubAccountLabel: "Name des Kontos oder der Organisation, wie in github.com/name",
  githubNextButton: "Weiter",
  githubReviewIntro:
    "Seluna bittet GitHub, diese App zu erstellen. Prüfe auf GitHub die Angaben und wähle Create GitHub App; GitHub schickt dich danach hierher zurück. Seluna speichert die App nur, wenn GitHub sie für das hier gezeigte Konto erstellt hat.",
  githubReviewAccountLabel: "Konto:",
  githubAppNameLabel: "App-Name:",
  githubPermissionsLabel: "Berechtigungen, alle nur lesend:",
  githubPermissionsList:
    "Actions, Contents, Issues, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts, Metadata",
  githubEventsLabel: "Ereignisse:",
  githubEventsList:
    "Pull request, Workflow run, Dependabot alert, Code scanning alert, Secret scanning alert, Issues, Issue comment, Fork, Star",
  githubToGitHubButton: "Weiter zu GitHub",
  githubFinishIntro:
    "GitHub hat die App erstellt. Wähle Abschließen, damit Seluna ihre Zugangsdaten abruft und speichert.",
  githubFinishButton: "Abschließen",
  githubCreated: "Die GitHub-App ist gespeichert.",
  githubInstallIntro:
    "Installiere sie jetzt auf deinem Konto oder deiner Organisation. Empfohlen ist die Auswahl Only select repositories: Seluna sieht dann nur die Repositories, die du auswählst, und ein neues Repository fügst du der Installation von Hand hinzu.",
  githubInstallLink: "App auf GitHub installieren",
  githubInstallManual:
    "Installiere sie auf GitHub: Öffne in den Einstellungen deines Kontos oder deiner Organisation Developer settings, dann GitHub Apps, wähle die App und klicke auf Install App. Empfohlen ist die Auswahl Only select repositories: Seluna sieht dann nur die Repositories, die du auswählst, und ein neues Repository fügst du der Installation von Hand hinzu.",
  githubBackLink: "Zurück zum Schritt GitHub-App",
  statusHeading: "Status",
  versionLabel: "Version:",
  botTokenLabel: "Telegram-Bot-Token:",
  botTokenSecret: "Gesetzt durch das Worker-Secret TELEGRAM_BOT_TOKEN.",
  botTokenSaved: "In der Einrichtung gespeichert.",
  telegramChatLabel: "Telegram-Chat:",
  noneSavedYet: "Noch nichts gespeichert.",
  chatSecret: "Gesetzt durch das Worker-Secret TELEGRAM_CHAT_ID.",
  githubAppLabel: "GitHub-App:",
  appSecrets: "Gesetzt durch die Worker-Secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY und GITHUB_WEBHOOK_SECRET.",
  appPartial:
    "Nur einige der Worker-Secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY und GITHUB_WEBHOOK_SECRET sind gesetzt.",
  appIdLabel: "App-ID",
  cannotBeRead: "Mit dem aktuellen SELUNA_SECRET nicht lesbar.",
  lastDeliveryLabel: "Letzte Zustellung von GitHub:",
  noneReceivedYet: "Noch nichts empfangen.",
  installationsLabel: "Installationen:",
  accountPersonal: "persönliches Konto",
  accountOrganization: "Organisation",
  accountOther: "anderes Konto",
  accountEnterprise: "Enterprise",
  unknownAccount: "Unbekanntes Konto",
  repositoriesAll: "alle Repositories",
  repositoriesSelected: "ausgewählte Repositories",
  installationSuspended: "gesperrt",
  notInstalled: "Noch auf keinem Konto installiert.",
  moreInstallations: "Nur die ersten 100 Installationen werden angezeigt.",
  installationsUnavailable: "Kann gerade nicht von GitHub geladen werden.",
  keyUnusable: "Der private Schlüssel der App ist nicht verwendbar.",
  ownerLabel: "Besitzer der GitHub-App:",
  ownerUnavailable: "Kann gerade nicht von GitHub gelesen werden.",
  ownerOrganizationNotice:
    "Die App gehört einer Organisation, deshalb kann Seluna deine eigenen Aktionen nicht von denen anderer unterscheiden: Aktivitäten aller Konten werden gemeldet, auch deine.",
  appMissingLabel: "Fehlt der App:",
  appUnchecked: "Seluna konnte die Berechtigungen der App nicht von GitHub lesen.",
  appSettingsLink: "In den Einstellungen der App auf GitHub ergänzen",
  readOnlySuffix: "nur lesend",
  eventsLabel: "Ereignisse:",
  installationMissing: "fehlt:",
  installationReviewLink: "Auf GitHub prüfen und annehmen",
  accessNotChecked: "Zugriff nicht geprüft",
  resetHeading: "Die gespeicherten Zugangsdaten sind nicht lesbar",
  resetText:
    "Die gespeicherten Zugangsdaten sind mit dem aktuellen SELUNA_SECRET nicht lesbar: Es wurde geändert, oder ein gespeicherter Wert ist beschädigt. Wenn du das frühere SELUNA_SECRET noch kennst, setze es stattdessen wieder. Andernfalls setze zurück: Seluna löscht die gespeicherten GitHub-Zugangsdaten, die Installations-Tokens und den gespeicherten Telegram-Bot-Token; du erstellst danach die GitHub-App neu und gibst den Bot-Token im Schritt Telegram-Chat erneut ein. Lösche die alte App danach auf GitHub: in den Einstellungen deines Kontos oder deiner Organisation unter Developer settings, dann GitHub Apps. Der Telegram-Chat und die Einstellungen bleiben erhalten.",
  resetButton: "Zurücksetzen und GitHub-App neu erstellen",
  settingsHeading: "Einstellungen",
  notificationLanguageLabel: "Sprache der Benachrichtigungen",
  timeZoneLabel: "Zeitzone",
  quietHoursLabel: "Ruhezeiten: Benachrichtigungen kommen ohne Ton",
  quietStartLabel: "Beginn",
  quietEndLabel: "Ende",
  rulesLabel: "Benachrichtige mich über",
  updateNoticeLabel: "Sag mir Bescheid, wenn ein neues Seluna-Release verfügbar ist",
  saveSettingsButton: "Einstellungen speichern",
  ruleLabels: {
    pull_request_opened: "Neuer Pull Request",
    pull_request_ready_for_review: "Pull Request bereit zum Review",
    pull_request_review_requested: "Review angefordert",
    ci_failed_default_branch: "CI auf dem Standard-Branch fehlgeschlagen",
    ci_failed_pull_request: "CI in einem Pull Request fehlgeschlagen",
    dependabot_alert: "Dependabot-Warnung",
    code_scanning_alert: "Code-Scanning-Warnung",
    secret_scanning_alert: "Secret-Scanning-Warnung",
  },
  notConfiguredHeading: "SELUNA_SECRET ist nicht gesetzt",
  notConfiguredParagraphs: [
    "Die Einrichtung kann nicht starten, weil das Worker-Secret SELUNA_SECRET fehlt oder kürzer als 32 Zeichen ist.",
    "Erzeuge eine zufällige Zeichenfolge mit mindestens 32 Zeichen, zum Beispiel mit einem Passwortmanager oder mit: openssl rand -hex 32",
    "Öffne im Cloudflare-Dashboard diesen Worker, dann Settings, dann Variables and Secrets, und füge ein Secret namens SELUNA_SECRET mit dieser Zeichenfolge hinzu. Oder führe aus: npx wrangler secret put SELUNA_SECRET",
    "Lade danach diese Seite neu.",
  ],
  messengersHeading: "Messenger",
  messengersIntro:
    "Seluna sendet seine Benachrichtigungen über einen Messenger, den aktiven. Richte einen Messenger ein und aktiviere ihn dann; noch wartende Benachrichtigungen werden danach über ihn gesendet.",
  messengerStateNotSetUp: "Nicht eingerichtet",
  messengerStateSetUp: "Eingerichtet",
  messengerStateActive: "Aktiv",
  messengerActiveNotSetUp: "Aktiv, aber nicht eingerichtet: Benachrichtigungen warten, bis er eingerichtet ist.",
  messengerSetUpLink: "Einrichten",
  messengerChangeLink: "Ändern",
  messengerActivateButton: "Aktivieren",
  messengerRemoveButton: "Entfernen",
  messengerLabel: "Messenger:",
  messengerNotSetUpSuffix: "(nicht eingerichtet)",
  telegramActiveNotSetUp:
    "Telegram ist der aktive Messenger: Benachrichtigungen warten, bis hier ein Bot-Token und ein Chat eingerichtet sind.",
  notices: {
    "messenger-invalid": "Bitte wähle einen Messenger aus der Liste.",
    "messenger-not-set-up":
      "Dieser Messenger ist noch nicht eingerichtet. Richte ihn zuerst ein und aktiviere ihn dann.",
    "messenger-worker-secrets":
      "Dieser Messenger ist durch Worker-Secrets gesetzt, die Seluna nicht entfernen kann. Lösche sie im Cloudflare-Dashboard unter Settings, dann Variables and Secrets.",
    "wrong-secret": "Das ist nicht das SELUNA_SECRET dieser Instanz.",
    locked:
      "Zu viele fehlgeschlagene Versuche. Die Anmeldung ist nach dem fünften fehlgeschlagenen Versuch 15 Minuten lang gesperrt; versuche es später erneut.",
    "form-expired": "Das Formular ist abgelaufen. Bitte sende es erneut ab.",
    unavailable: "Die Einrichtung ist gerade nicht verfügbar. Bitte versuche es gleich noch einmal.",
    "migrations-missing":
      "Der Datenbank dieser Instanz fehlen ihre Tabellen: Die Datenbank-Migrationen wurden nicht ausgeführt. Öffne im Cloudflare-Dashboard Workers & Pages, diesen Worker, Settings und Build, setze den Deploy command auf npm run deploy und wiederhole den letzten Build, wie es die Einrichtungsanleitung beschreibt.",
    "telegram-token-missing":
      "Es ist kein verwendbarer Bot-Token verfügbar. Öffne den Schritt Telegram-Chat und prüfe dort den Bot-Token.",
    "telegram-token-malformed":
      "Das Worker-Secret TELEGRAM_BOT_TOKEN ist kein Bot-Token. Ein Token von @BotFather besteht aus Ziffern, einem Doppelpunkt und dann Buchstaben, Ziffern, - und _, ohne Leerzeichen. Kopiere ihn erneut von @BotFather und ersetze das Secret im Cloudflare-Dashboard unter Settings, dann Variables and Secrets.",
    "telegram-token-rejected":
      "Telegram akzeptiert das Worker-Secret TELEGRAM_BOT_TOKEN nicht: Es ist falsch geschrieben oder wurde widerrufen. Sende /mybots an @BotFather, kopiere den aktuellen Token deines Bots und ersetze das Secret im Cloudflare-Dashboard unter Settings, dann Variables and Secrets.",
    "telegram-token-invalid":
      "Das ist kein Bot-Token. Ein Token von @BotFather besteht aus Ziffern, einem Doppelpunkt und dann Buchstaben, Ziffern, - und _, ohne Leerzeichen. Kopiere ihn erneut von @BotFather. Es wurde nichts gespeichert.",
    "telegram-token-not-accepted":
      "Telegram akzeptiert diesen Token nicht: Er ist falsch geschrieben oder wurde widerrufen. Sende /mybots an @BotFather, kopiere den aktuellen Token deines Bots und gib ihn erneut ein. Es wurde nichts gespeichert.",
    "telegram-token-unverified":
      "Telegram war nicht erreichbar oder hat eine Antwort gegeben, die Seluna nicht lesen kann, daher wurde der Token nicht gespeichert. Bitte versuche es gleich noch einmal.",
    "telegram-saved-token-rejected":
      "Telegram akzeptiert den gespeicherten Bot-Token nicht: Er wurde widerrufen oder der Bot wurde gelöscht. Sende /mybots an @BotFather, kopiere den aktuellen Token deines Bots und gib ihn hier ein.",
    "telegram-token-unreadable":
      "Der gespeicherte Bot-Token lässt sich mit dem aktuellen SELUNA_SECRET nicht lesen: Es wurde geändert, oder die gespeicherten Werte sind beschädigt. Setze das frühere SELUNA_SECRET wieder, oder setze die gespeicherten Zugangsdaten auf der Startseite zurück und gib den Token erneut ein.",
    "telegram-token-damaged":
      "Der gespeicherte Bot-Token ist beschädigt und lässt sich nicht lesen. Gib den Token erneut ein, oder entferne ihn.",
    "telegram-token-not-saved":
      "Der Token wurde nicht gespeichert, weil sich die gespeicherten Zugangsdaten mit dem aktuellen SELUNA_SECRET nicht lesen lassen. Setze das frühere SELUNA_SECRET wieder, oder setze die gespeicherten Zugangsdaten zuerst auf der Startseite zurück.",
    "telegram-conflict":
      "Telegram gibt die Chats des Bots nicht an Seluna weiter, weil ein anderes Programm seine Updates empfängt (ein Webhook oder ein Programm, das den Bot abfragt). Seluna braucht einen eigenen Bot: Erstelle mit /newbot bei @BotFather einen, oder entferne den Webhook dieses Bots.",
    "telegram-unavailable":
      "Telegram war nicht erreichbar oder hat eine Antwort gegeben, die Seluna nicht lesen kann. Bitte versuche es gleich noch einmal.",
    "telegram-send-failed":
      "Die Testnachricht konnte nicht gesendet werden, daher wurde der Chat nicht gespeichert. Prüfe, ob der Bot noch im Chat ist und nicht blockiert wurde, und suche dann erneut.",
    "telegram-invalid-chat": "Bitte wähle einen Chat aus der Liste.",
    "telegram-wrong-code":
      "Der Code passt nicht zur Testnachricht. Prüfe den Code in deinem Chat und gib ihn erneut ein.",
    "telegram-code-expired":
      "Der Code ist abgelaufen oder das Formular ist nicht mehr gültig. Suche erneut nach Chats und sende eine neue Testnachricht.",
    "github-invalid-account":
      "Wähle dein persönliches Konto oder eine Organisation und gib den Namen ein: 1 bis 39 Buchstaben, Ziffern und Bindestriche, ohne Bindestrich am Anfang oder Ende.",
    "github-return-invalid":
      "Diese Seite braucht den Code und den State, die GitHub nach dem Erstellen der App zurückschickt. Beginne erneut beim Schritt GitHub-App.",
    "github-state-invalid":
      "Diese Rückkehr von GitHub gehört nicht zu deiner aktuellen Anmeldung oder ist älter als eine Stunde, daher wurde nichts gespeichert. Falls GitHub eine App erstellt hat, lösche sie auf GitHub und beginne erneut.",
    "github-code-rejected":
      "GitHub akzeptiert diese Rückkehr nicht mehr: Der Code wurde schon verwendet oder ist älter als eine Stunde. Öffne den Schritt GitHub-App und vergleiche die dort gespeicherte App-ID mit der, die GitHub in den Einstellungen der App zeigt: Stimmen sie überein, ist die App gespeichert; andernfalls lösche die App auf GitHub und beginne erneut.",
    "github-unavailable":
      "GitHub war nicht erreichbar. Wähle gleich noch einmal Abschließen; die Rückkehr bleibt eine Stunde lang gültig.",
    "github-answer-invalid":
      "GitHub hat die App erstellt, aber ihre Antwort ließ sich nicht lesen, daher wurde nichts gespeichert. Lösche die App auf GitHub und beginne erneut.",
    "github-owner-mismatch":
      "Diese App gehört nicht zu dem Konto, das du in Seluna gewählt hast, daher wurde nichts gespeichert. Wenn du sie selbst erstellt hast, lösche sie auf GitHub und beginne erneut mit dem Namen des Kontos, bei dem du auf GitHub angemeldet bist, oder der Organisation.",
    "github-store-failed":
      "GitHub hat die App erstellt, aber das Speichern ihrer Zugangsdaten ist fehlgeschlagen, daher wurde nichts gespeichert. Lösche die App auf GitHub und beginne erneut.",
    "settings-invalid":
      "Die Einstellungen wurden nicht gespeichert. Prüfe die Werte: Ruhezeiten brauchen einen Beginn und ein Ende in der Form 22:00, und beide müssen sich unterscheiden.",
    "reset-not-needed":
      "Die gespeicherten Zugangsdaten sind mit dem aktuellen SELUNA_SECRET lesbar, daher wurde nichts zurückgesetzt.",
  },
};

/** The texts of every page in each language. */
export const TEXTS: Readonly<Record<Language, SetupTexts>> = { en: ENGLISH, de: GERMAN };
