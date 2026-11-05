# Setup

Deutsch: [Einrichtungsanleitung](setup.de.md)

How to set up your own Seluna instance, in your web browser and with the Telegram app on your phone. You type no command. If you prefer the command line, or want to create the GitHub App yourself, follow the [manual setup](manual-setup.md) instead. If a step does not work, [Troubleshooting](troubleshooting.md) has the symptom.

Statements marked _Not yet confirmed by a test run_ describe a page of another service (Telegram, Cloudflare, GitHub) as its own documentation describes it; they have not been run end to end yet. Where one of them differs from what you see, the service's own page is right.

## What you need

- A desktop web browser and the Telegram app on your phone.
- A free account at [GitHub](https://github.com/signup), at [Cloudflare](https://dash.cloudflare.com/sign-up) and at [Telegram](https://telegram.org/). A personal GitHub account is what this guide follows.
- A password manager, or another place where you can keep a long random password.

## 1. Create the Telegram bot

Seluna sends its notifications through a Telegram bot of your own.

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Answer its questions: a name for the bot, then a username that ends in `bot`.
3. Copy the token that @BotFather returns and keep it for step 5. Treat it like a password.
4. Open your new bot and send it `/start`. The bot does not answer: Seluna only sends messages, it never replies in Telegram.

@BotFather's own description of this step is in [Telegram's documentation](https://core.telegram.org/bots/features#botfather). _Not yet confirmed by a test run: the exact questions and wording of @BotFather._

**It worked when** @BotFather has sent you a message with the bot's token.

## 2. Create the SELUNA_SECRET

`SELUNA_SECRET` is the password of your instance's setup page, and the key that encrypts the credentials Seluna stores comes from it.

1. In your password manager, generate a random password of at least 32 characters, for example 40 letters and digits. A shorter one is refused.
2. Save it in the password manager, for example as an entry named "Seluna".

Keep it: if you change it later, Seluna can no longer read what it stored, and you run parts of the setup again ([Troubleshooting](troubleshooting.md#i-changed-the-seluna_secret)).

**It worked when** you have a random password of at least 32 characters saved in your password manager.

## 3. Deploy to Cloudflare

1. Open the [README](../README.md) and select **Deploy to Cloudflare**.
2. Sign in to Cloudflare and connect your GitHub account when asked.
3. The form creates an independent copy of the repository in your GitHub account (not a fork), creates the D1 database and asks for `SELUNA_SECRET`. Paste the password from step 2, then continue until Cloudflare builds and deploys the Worker.
4. When the deploy has finished, check the deploy command. In the Cloudflare dashboard open **Workers & Pages**, your Worker, then **Settings** and **Build**, and look at **Deploy command**. It must read `npm run deploy`, which creates the database tables before it deploys the Worker. The button sometimes sets `npx wrangler deploy` instead; then change it to `npm run deploy`, save and retry the latest build (**Deployments**). Cloudflare describes the build settings in its [documentation on build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
5. Write down the address of your Worker, `https://<worker>.<your-subdomain>.workers.dev`; the dashboard shows it on the Worker's page.

Do not test Seluna in this copy of the repository: every merge into its `main` branch deploys your instance again.

_Not yet confirmed by a test run: the Cloudflare form and dashboard menus as named above._

**It worked when** the build log of the latest build shows the line `> wrangler d1 migrations apply DB --remote`, and `https://<worker>.<your-subdomain>.workers.dev/health` answers with the version of Seluna.

## 4. Open the setup page and sign in

1. Open `https://<worker>.<your-subdomain>.workers.dev/` in your browser. It leads to the setup page. The links at the top right, **English** and **Deutsch**, switch the language of the pages.
2. Enter your `SELUNA_SECRET` in the field **SELUNA_SECRET** and select **Sign in**.

![The sign-in page of the setup: the heading "Sign in", a field SELUNA_SECRET and the button Sign in](assets/setup/en/01-login.png)

If you sign in wrongly five times, signing in is locked for 15 minutes ([Troubleshooting](troubleshooting.md#signing-in-is-locked)).

**It worked when** the page "You are signed in" opens, with the cards **Status** and **Messengers** and the links **Telegram chat** and **GitHub App**.

![The start page of a new instance: the status shows no bot token, no chat and no GitHub App yet, and the Messengers card lists Telegram as active but not set up](assets/setup/en/02-start-empty.png)

## 5. Connect the Telegram chat

Select **Telegram chat** at the top of the page.

1. Enter the bot token from step 1 in the field **Bot token** and select **Save token**. Seluna checks the token with Telegram and saves it encrypted; it is not shown again.

![The Telegram chat step before a token is saved: a card Bot token with a field and the button Save token](assets/setup/en/03-telegram-token.png)

2. The step now lists the chats your bot has seen. Your own chat, named as in Telegram and marked **Private chat**, appears because you sent `/start` in step 1. If the list is empty (the page then says _No chat found_), send `/start` to your bot again and select **Search for chats**. Anyone who messages your bot appears here, so choose only your own chat.
3. Select your chat and select **Send test message**.

![The Telegram chat step after the token is saved: the saved-token message, the link Search for chats and one private chat to choose, with the button Send test message](assets/setup/en/04-telegram-chats.png)

4. Seluna sends a message with a six-digit code to that chat. Enter the code in the field **Code** and select **Save chat**.

![The code page: the chat the test message went to, a field Code and the button Save chat](assets/setup/en/05-telegram-code.png)

**It worked when** the step shows **Saved chat:** with the number of your chat, and the start page shows the number next to **Telegram chat:**. The code proves that the chat is yours; if no message arrived, the chat is not yours.

If you want to set the token or the chat by hand as Worker secrets instead, see the [manual setup](manual-setup.md#9-optional-set-the-telegram-bot-token-and-chat-by-hand).

## 6. Create the GitHub App

Seluna receives the events of your repositories through a private GitHub App of its own. The setup creates it for you. Select **GitHub App** at the top of the page.

1. Select **My personal account**, enter your GitHub user name in the field **Name of the account or organization, as in github.com/name** and select **Next**. (The page also offers **An organization**; this guide follows the personal account.)

![The GitHub App step: the choice My personal account or An organization, a field for the account name and the button Next](assets/setup/en/06-github-account.png)

2. Seluna shows what it will ask GitHub for: the app's name (`seluna-` and your account name), read-only permissions and the events it subscribes to. Select **Continue to GitHub**.

![The review page: the account, the app name, the read-only permissions, the events and the button Continue to GitHub](assets/setup/en/07-github-review.png)

3. On GitHub, check the details, change the app's name if you wish, and select **Create GitHub App**. GitHub's own description is in its documentation on [registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).
4. GitHub sends you back to the setup. Select **Finish**: Seluna fetches the app's credentials and saves them encrypted.

![The finish page: the message that GitHub has created the app and the button Finish](assets/setup/en/08-github-finish.png)

Do this within one hour, and while you are still signed in to the setup page. Otherwise Seluna refuses the return and nothing is saved ([Troubleshooting](troubleshooting.md#the-return-from-github-is-refused)). Creating the app again replaces the saved one; delete the old app on GitHub afterwards.

_Not yet confirmed by a test run: GitHub's page for creating the app and its wording._

**It worked when** the page says **The GitHub App is saved.** and offers the link **Install the app on GitHub**.

![The page after the app was created: the message that the GitHub App is saved and the link Install the app on GitHub](assets/setup/en/09-github-created.png)

## 7. Install the app on a test repository

The app sees only the repositories you give it. Seluna recommends **Only select repositories**: only the repositories you pick report to Seluna, and you add a new repository to the installation by hand.

1. On GitHub, select **New repository**, name it for example `seluna-test`, make it **Private**, check **Add a README file** and select **Create repository**.
2. In the setup page select **Install the app on GitHub**. GitHub's page for installing an app opens ([documentation](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)).
3. Choose your account, select **Only select repositories**, pick the test repository and select **Install**.
4. Go back to the setup page and select **Start page** at the top.

_Not yet confirmed by a test run: GitHub's installation page and its wording._

**It worked when** the **Status** card lists **Installations:** with your account, **personal account**, **selected repositories**, and shows your account after **GitHub App owner:**. If it names something under **Missing on the app** or marks the installation **missing**, follow its links to add and accept it on GitHub.

![The start page of a finished setup: the status shows version, bot token, chat, GitHub App with its owner, the installation on selected repositories and the last delivery](assets/setup/en/10-start-done.png)

## 8. Review the settings

Below the status and the messengers, the start page shows the card **Settings**. Check these and select **Save settings**:

- **Language of the notifications**: English or Deutsch.
- **Time zone**: UTC until you change it; choose yours.
- **Quiet hours: notifications arrive without sound**: tick it and set **Start** and **End** if you want messages without sound at night. They still arrive.
- **Notify me about**: one switch per kind of message. **New star on a repository** and **New fork of a repository** are off until you turn them on; **Stars and forks** sets whether they come immediately, hourly or daily.
- **Tell me when a new Seluna release is available**.

Issues and comments you wrote yourself are left out. Seluna knows who you are once the status page shows the **GitHub App owner:**; open the start page once after the installation. A pull request you open yourself is reported, so your test in step 9 gives a message.

![The settings card: language, time zone, quiet hours, the switches for the kinds of notification, the interval for stars and forks and the button Save settings](assets/setup/en/11-settings.png)

**It worked when** you reload the page and the settings show the values you saved.

## 9. Test with a pull request

1. On GitHub, open the test repository from step 7 and open the file `README.md`.
2. Select the pencil (**Edit this file**), change a line and select **Commit changes...**.
3. Choose **Create a new branch for this commit and start a pull request**, then select **Propose changes**.
4. On the next page select **Create pull request**. Do not choose the draft option: a draft pull request gives no message.

_Not yet confirmed by a test run: GitHub's editing and pull request pages and their wording._

**It worked when** Telegram shows a message **New pull request** (**Neuer Pull Request** if you set the **Language of the notifications** to Deutsch) from your bot, with the repository, the title of your pull request and a button that opens it. On the start page, **Last delivery from GitHub:** then shows the time. Your instance is set up.

If no message arrives, [Troubleshooting](troubleshooting.md#no-message-arrives) lists the causes, cheapest first.

## Updates

Every push to `main` of your copy builds and deploys it. To apply a new Seluna release to your copy, run the update workflow in GitHub's web interface; [Update](update.md) explains how, and what to do about conflicts and permissions.

## If something does not work

[Troubleshooting](troubleshooting.md) is organized by symptom: no message, signing in, the Telegram step, the GitHub App step, GitHub's **Recent Deliveries**.
