import { describe, expect, it } from "vitest";
import { TEXTS } from "./texts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Every text in `value`, whatever the nesting of records and lists. */
function textsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return isRecord(value) ? Object.values(value).flatMap(textsOf) : [];
}

describe("TEXTS", () => {
  it("texts define a non-empty text for every key in English and German", () => {
    const emptyEnglish = textsOf(TEXTS.en).filter((text) => text.trim() === "");
    const emptyGerman = textsOf(TEXTS.de).filter((text) => text.trim() === "");

    expect(emptyEnglish, "empty English texts").toEqual([]);
    expect(emptyGerman, "empty German texts").toEqual([]);
    expect(TEXTS.en.notConfiguredParagraphs.length, "English not-configured paragraphs").toBeGreaterThan(0);
    expect(TEXTS.de.notConfiguredParagraphs.length, "German not-configured paragraphs").toBeGreaterThan(0);
    expect(Object.keys(TEXTS.de.notices), "German notice keys").toEqual(Object.keys(TEXTS.en.notices));
    expect(Object.keys(TEXTS.en.notices).length, "number of notices").toBe(24);
  });

  it("texts word the English notices as the area document does", () => {
    expect(TEXTS.en.notices, "English notices").toEqual({
      "wrong-secret": "That is not the SELUNA_SECRET of this instance.",
      locked:
        "Too many failed attempts. Signing in is locked for 15 minutes after the fifth failed attempt; try again later.",
      "form-expired": "The form has expired. Please submit it again.",
      unavailable: "The setup is unavailable right now. Please try again in a moment.",
      "migrations-missing":
        "The database of this instance is missing its tables: the database migrations have not run. In the Cloudflare dashboard open Workers & Pages, this Worker, Settings and Build, set the Deploy command to npm run deploy and retry the latest build, as the setup guide describes.",
      "telegram-token-missing":
        "The Worker secret TELEGRAM_BOT_TOKEN is not set. In Telegram, send /newbot to @BotFather and copy the token it returns. In the Cloudflare dashboard open this Worker, then Settings, then Variables and Secrets, and add a secret named TELEGRAM_BOT_TOKEN with that token. Or run: npx wrangler secret put TELEGRAM_BOT_TOKEN",
      "telegram-token-malformed":
        "The Worker secret TELEGRAM_BOT_TOKEN is not a bot token. A token from @BotFather is digits, a colon, then letters, digits, - and _, without spaces. Copy it again from @BotFather and replace the secret in the Cloudflare dashboard under Settings, then Variables and Secrets.",
      "telegram-token-rejected":
        "Telegram does not accept the Worker secret TELEGRAM_BOT_TOKEN: it is mistyped or was revoked. Send /mybots to @BotFather, copy your bot's current token and replace the secret in the Cloudflare dashboard under Settings, then Variables and Secrets.",
      "telegram-conflict":
        "Telegram does not hand the bot's chats to Seluna because another program receives its updates (a webhook, or a program that polls the bot). Seluna needs a bot of its own: create one with /newbot at @BotFather, or remove the webhook from this bot.",
      "telegram-unavailable":
        "Telegram could not be reached or gave an answer Seluna cannot read. Please try again in a moment.",
      "telegram-send-failed":
        "The test message could not be sent, so the chat was not saved. Check that the bot is still in the chat and not blocked, then search again.",
      "telegram-invalid-chat": "Please choose a chat from the list.",
      "telegram-wrong-code":
        "The code does not match the test message. Check the code in your chat and enter it again.",
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
    });
  });

  it("texts word the English Telegram step as the area document does", () => {
    const { en } = TEXTS;

    expect(
      {
        startBody: en.startBody,
        telegramHeading: en.telegramHeading,
        telegramIntro: en.telegramIntro,
        telegramSearchLink: en.telegramSearchLink,
        telegramChatIdSecret: en.telegramChatIdSecret,
        telegramSavedChat: en.telegramSavedChat,
        telegramNoSavedChat: en.telegramNoSavedChat,
        telegramChatsIntro: en.telegramChatsIntro,
        telegramNoChats: en.telegramNoChats,
        telegramPrivateChat: en.telegramPrivateChat,
        telegramGroup: en.telegramGroup,
        telegramConfirmButton: en.telegramConfirmButton,
        telegramTestMessage: en.telegramTestMessage,
        telegramCodeSent: en.telegramCodeSent,
        telegramCodeIntro: en.telegramCodeIntro,
        telegramCodeLabel: en.telegramCodeLabel,
        telegramCodeButton: en.telegramCodeButton,
      },
      "English Telegram step texts",
    ).toEqual({
      startBody: "Set up your instance step by step:",
      telegramHeading: "Telegram chat",
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
    });
  });

  it("texts word the English GitHub step as the area document does", () => {
    const { en } = TEXTS;

    expect(
      {
        githubHeading: en.githubHeading,
        githubIntro: en.githubIntro,
        githubWorkerSecrets: en.githubWorkerSecrets,
        githubPartialWorkerSecrets: en.githubPartialWorkerSecrets,
        githubResetNeeded: en.githubResetNeeded,
        githubSavedApp: en.githubSavedApp,
        githubNoSavedApp: en.githubNoSavedApp,
        githubReplaceHint: en.githubReplaceHint,
        githubPersonal: en.githubPersonal,
        githubOrganization: en.githubOrganization,
        githubAccountLabel: en.githubAccountLabel,
        githubNextButton: en.githubNextButton,
        githubReviewIntro: en.githubReviewIntro,
        githubReviewAccountLabel: en.githubReviewAccountLabel,
        githubAppNameLabel: en.githubAppNameLabel,
        githubPermissionsLabel: en.githubPermissionsLabel,
        githubPermissionsList: en.githubPermissionsList,
        githubEventsLabel: en.githubEventsLabel,
        githubEventsList: en.githubEventsList,
        githubToGitHubButton: en.githubToGitHubButton,
        githubFinishIntro: en.githubFinishIntro,
        githubFinishButton: en.githubFinishButton,
        githubCreated: en.githubCreated,
        githubInstallIntro: en.githubInstallIntro,
        githubInstallLink: en.githubInstallLink,
        githubInstallManual: en.githubInstallManual,
        githubBackLink: en.githubBackLink,
      },
      "English GitHub step texts",
    ).toEqual({
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
        "Actions, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts, Metadata",
      githubEventsLabel: "Events:",
      githubEventsList: "Pull request, Workflow run, Dependabot alert, Code scanning alert, Secret scanning alert",
      githubToGitHubButton: "Continue to GitHub",
      githubFinishIntro: "GitHub has created the app. Select Finish so that Seluna fetches and saves its credentials.",
      githubFinishButton: "Finish",
      githubCreated: "The GitHub App is saved.",
      githubInstallIntro:
        "Now install it on your account or organization. Choosing All repositories is recommended, so that new repositories are covered too.",
      githubInstallLink: "Install the app on GitHub",
      githubInstallManual:
        "Install it on GitHub: in the settings of your account or organization, open Developer settings, then GitHub Apps, choose the app and select Install App. Choosing All repositories is recommended, so that new repositories are covered too.",
      githubBackLink: "Back to the GitHub App step",
    });
  });

  it("texts word the English status page and settings as the area document does", () => {
    const { en } = TEXTS;

    expect(
      {
        statusHeading: en.statusHeading,
        versionLabel: en.versionLabel,
        telegramChatLabel: en.telegramChatLabel,
        noneSavedYet: en.noneSavedYet,
        chatSecret: en.chatSecret,
        githubAppLabel: en.githubAppLabel,
        appSecrets: en.appSecrets,
        appPartial: en.appPartial,
        appIdLabel: en.appIdLabel,
        cannotBeRead: en.cannotBeRead,
        lastDeliveryLabel: en.lastDeliveryLabel,
        noneReceivedYet: en.noneReceivedYet,
        resetHeading: en.resetHeading,
        resetText: en.resetText,
        resetButton: en.resetButton,
        startPageLink: en.startPageLink,
        settingsHeading: en.settingsHeading,
        notificationLanguageLabel: en.notificationLanguageLabel,
        timeZoneLabel: en.timeZoneLabel,
        quietHoursLabel: en.quietHoursLabel,
        quietStartLabel: en.quietStartLabel,
        quietEndLabel: en.quietEndLabel,
        rulesLabel: en.rulesLabel,
        updateNoticeLabel: en.updateNoticeLabel,
        saveSettingsButton: en.saveSettingsButton,
        ruleLabels: en.ruleLabels,
      },
      "English status and settings texts",
    ).toEqual({
      statusHeading: "Status",
      versionLabel: "Version:",
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
      resetHeading: "The saved credentials cannot be read",
      resetText:
        "The saved GitHub credentials cannot be read with the current SELUNA_SECRET: it was changed, or the saved values are damaged. If you still know the earlier SELUNA_SECRET, set it again instead. Otherwise reset: Seluna deletes the saved GitHub credentials and installation tokens, and you create the GitHub App again. Delete the old app on GitHub afterwards: in the settings of your account or organization, under Developer settings, then GitHub Apps. The Telegram chat and the settings are kept.",
      resetButton: "Reset and create the GitHub App again",
      startPageLink: "Open the start page",
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
    });
  });
});
