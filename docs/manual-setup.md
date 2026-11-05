# Manual setup

How to deploy your own Seluna instance with the Wrangler command line, and optionally create the GitHub App by hand. The [setup guide](setup.md) ([Deutsch](setup.de.md)) does everything in the browser and is the simpler way; use this page if you prefer the command line or want to control each setting yourself. Both ways give the same instance and use the same setup pages afterwards. If a step fails, [Troubleshooting](troubleshooting.md#a-command-of-the-manual-setup-fails) helps.

Statements marked _Not yet confirmed by a test run_ describe the output or a prompt of a tool or service as its own documentation describes it; they have not been run end to end yet.

## What you need

- Linux, macOS, or Windows with WSL, and a POSIX shell (Bash or Zsh).
- [Node.js](https://nodejs.org/) 24 and npm (`node --version` shows `v24` and a number).
- [Git](https://git-scm.com/).
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account and a desktop browser: `wrangler login` opens it.
- A free GitHub account and the Telegram app, as in the [setup guide](setup.md#what-you-need).

## How to run the commands

- Copy one command at a time. Each block below holds exactly one command; never paste several blocks at once.
- After each block, check what it should show before you go on. If a command fails, stop there: later steps need its result.
- The blocks of `npx wrangler login` and `npx wrangler secret put ...` ask for input. A line pasted after such a command would become the answer to its prompt, and for a secret that would be the secret's value. Run those commands alone.
- No command uses a shell variable, and no secret is ever typed as part of a command: secrets are typed at a prompt or read from a file, so they stay out of your shell history.

## 1. Clone the repository

Clone the original repository:

```sh
git clone https://github.com/LarsLaskowski/Seluna.git
```

Or, if you already created your own copy with the Deploy button, clone that copy (replace the address with the one of your copy):

```sh
git clone https://github.com/your-account/your-copy.git
```

Then go into the folder:

```sh
cd Seluna
```

(For your own copy, the folder carries the name of your copy.)

**It worked when** the folder exists and contains `package.json`.

## 2. Choose the release

Deploy released code only.

- **Clone of the original repository:** open the [latest release](https://github.com/LarsLaskowski/Seluna/releases/latest), note its tag (`vX.Y.Z`), fetch the tags and check the tag out. Never deploy `main` of the original repository: it can hold changes no release has been cut from.

```sh
git fetch --tags
```

```sh
git checkout vX.Y.Z
```

(Replace `vX.Y.Z` with the tag of the latest release.)

- **Clone of your own copy:** stay on its `main`. Only the update workflow advances it ([Update](update.md)); there is nothing to check out.

**It worked when** `git status` names the tag (`HEAD detached at vX.Y.Z`) or, for your own copy, the branch `main`. If `git checkout` fails, stop: nothing is installed yet.

## 3. Install the dependencies

```sh
npm ci --ignore-scripts
```

`--ignore-scripts` keeps the dependencies' own install scripts from running. Install before you log in, so that no dependency code ever runs with your Cloudflare login stored.

**It worked when** the command ends without an error and the folder `node_modules` exists. _Not yet confirmed by a test run: that Wrangler works after an install with `--ignore-scripts`._

## 4. Log in to Cloudflare

This command opens your browser. Run it alone.

```sh
npx wrangler login
```

Allow Wrangler's access in the browser. Cloudflare describes it in the [Wrangler documentation](https://developers.cloudflare.com/workers/wrangler/commands/#login).

**It worked when** the browser says Wrangler is logged in, and the terminal command ends.

## 5. Create the database

The configuration in `wrangler.jsonc` names the database `seluna` and carries no database id: Wrangler finds the database by this name, so you create it once and record nothing.

```sh
npx wrangler d1 create seluna
```

Skip this step if the Deploy button already created the database for your own copy.

**It worked when** Wrangler reports the database `seluna`. Wrangler may print a configuration snippet with the database's id and offer to add it to your configuration; you do not need it, so decline. _Not yet confirmed by a test run: that the commands that follow find the database by its name, and the prompt Wrangler shows here._

## 6. Deploy

```sh
npm run deploy
```

This applies the database migrations to the remote database and then deploys the Worker. If the migrations fail, nothing is deployed and the command stops; do not go on. The first deploy may ask you to register a `workers.dev` subdomain; follow Cloudflare's prompt.

**It worked when** the output ends with the address of your Worker, `https://seluna.<your-subdomain>.workers.dev`, and `https://seluna.<your-subdomain>.workers.dev/health` answers with the version of Seluna. Use this address in the steps below. The Worker is named as the `name` line of `wrangler.jsonc` says (`seluna` in the original repository; a copy made with the Deploy button may carry another name, and then the address starts with that name).

## 7. Set SELUNA_SECRET

`SELUNA_SECRET` is the password of the setup page and the source of the key that encrypts the credentials Seluna stores. Create at least 32 random characters with your password manager's generator (or with `openssl rand -hex 32`, which prints 64 hexadecimal characters), and keep it in the password manager. A shorter one is refused.

This command asks for the value. Run it alone, then paste the secret at its prompt.

```sh
npx wrangler secret put SELUNA_SECRET
```

**It worked when** Wrangler reports that the secret was created, and `https://seluna.<your-subdomain>.workers.dev/` leads to the page **Sign in**. _Not yet confirmed by a test run: Wrangler's wording._

## 8. Set up the GitHub App

Choose one way.

### The wizard

Continue at [step 4 of the setup guide](setup.md#4-open-the-setup-page-and-sign-in) and follow it from there: sign in, the Telegram chat, the GitHub App, the installation, the settings and the test pull request. The wizard creates the app and stores its credentials encrypted.

### Create the GitHub App by hand

The wizard sets the app up with the exact permissions below; an app you create by hand must have the same, or Seluna misses events. In GitHub open **Settings**, **Developer settings**, **GitHub Apps** and select **New GitHub App** ([GitHub's documentation](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)). Enter:

- **GitHub App name**: any free name, for example `seluna-your-account`. **Homepage URL**: `https://github.com/LarsLaskowski/Seluna`.
- **Webhook**: **Active** checked. **Webhook URL**: `https://seluna.<your-subdomain>.workers.dev/webhook` (your Worker's address with `/webhook`). **SSL verification**: leave **Enable SSL verification** selected.
- **Secret** (the webhook secret): at least 32 random characters, generated like `SELUNA_SECRET`. Enter it here and again at the prompt of step 8.3 below, nowhere else. Keep it in your password manager.
- **Repository permissions**, all **Read-only**: **Actions**, **Contents**, **Issues**, **Pull requests**, **Dependabot alerts**, **Code scanning alerts**, **Secret scanning alerts**, **Metadata**. (In the API these are `actions`, `contents`, `issues`, `pull_requests`, `vulnerability_alerts`, `security_events`, `secret_scanning_alerts` and `metadata`.) No other permission.
- **Subscribe to events**: **Pull request**, **Workflow run**, **Dependabot alert**, **Code scanning alert**, **Secret scanning alert**, **Issues**, **Issue comment**, **Fork**, **Star**. No other event.
- **Where can this GitHub App be installed?**: **Only on this account**, so the app stays private to you.

Select **Create GitHub App**. _Not yet confirmed by a test run: GitHub's form and its labels._

Then give the Worker the app's credentials. Each of the three commands asks for its value and is run alone.

**8.1** The App ID is shown at the top of the app's settings page, under **About**. At the prompt enter only this number:

```sh
npx wrangler secret put GITHUB_APP_ID
```

**8.2** On the app's settings page select **Generate a private key**: GitHub downloads a `.pem` file. Keep it outside the cloned folder, for example in your downloads folder. The command reads the file; replace `<key file>` with its path:

```sh
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < <key file>
```

Then delete the file or keep it in your password manager. The Worker accepts the file as GitHub provides it. _Not yet confirmed by a test run: that the multi-line key is stored unchanged this way; the setup page's status shows the app, not **Cannot be read with the current SELUNA_SECRET.**, when it is._

**8.3** At the prompt enter the webhook secret you entered in GitHub's field:

```sh
npx wrangler secret put GITHUB_WEBHOOK_SECRET
```

Set all three. While any one of them is set, the setup creates no app, and while only some are set the status page says so. Without a webhook secret, the instance answers every webhook with 503.

Finally install the app: on the app's settings page select **Install App**, choose your account, select **Only select repositories** and pick the repositories (for a first test, the private test repository of [step 7](setup.md#7-install-the-app-on-a-test-repository) of the setup guide) ([GitHub's documentation](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)). **Only select repositories** keeps Seluna to the repositories you pick.

**It worked when** the status card on the setup page shows **GitHub App:** `Set by the Worker secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET.`, **GitHub App owner:** with your account and, under **Installations:**, your account with **selected repositories**. _Not yet confirmed by a test run: the status of an app created by hand._

## 9. Optional: set the Telegram bot token and chat by hand

You normally enter the bot token and the chat in the setup page's **Telegram chat** step, which saves them encrypted ([setup guide, step 5](setup.md#5-connect-the-telegram-chat)). Alternatively set them as Worker secrets. Each command asks for its value and is run alone.

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

```sh
npx wrangler secret put TELEGRAM_CHAT_ID
```

- `TELEGRAM_BOT_TOKEN` takes precedence over a token saved in the setup. While it is set, the step shows no token form; delete the secret to enter the token in the step.
- `TELEGRAM_CHAT_ID` takes precedence over the chat chosen in the step.
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` each take precedence over the saved credential of the same name, and the step creates no app while any of them is set.
- Warning: the Telegram Bot API takes the bot token in the request URL. Seluna never logs that URL, but if you turn on Workers traces or logs that record outbound requests in the Cloudflare dashboard, they record the token, whichever source it came from. Treat such traces as secret, or replace the token with `/revoke` at @BotFather afterwards.

## 10. Telegram chat and the test pull request

Sign in on the setup page (`https://seluna.<your-subdomain>.workers.dev/`) and follow [step 5](setup.md#5-connect-the-telegram-chat) of the setup guide (skip it if you set both Telegram secrets), then [step 8](setup.md#8-review-the-settings) and the [test pull request](setup.md#9-test-with-a-pull-request).

## Updates

Update only to a release; never deploy `main` of the original repository.

**Clone of the original repository:** fetch the tags, check out the tag of the new release, install and deploy.

```sh
git fetch --tags
```

```sh
git checkout vX.Y.Z
```

```sh
npm ci --ignore-scripts
```

```sh
npm run deploy
```

**Clone of your own copy:** run the update workflow in GitHub's web interface ([Update](update.md)), then bring its commit into your clone, install and deploy.

```sh
git pull
```

```sh
npm ci --ignore-scripts
```

```sh
npm run deploy
```

(`npm run deploy` is also what Workers Builds runs when you push to `main` of a copy made with the button; deploying by hand additionally is not needed there.) If a command fails, stop: `npm run deploy` already stops before the Worker is deployed when a migration fails, so the previous version keeps running. A release can ask more of the GitHub App; [Update](update.md#new-github-permissions) describes how to accept it. For an app you created by hand, add the permissions or events the status page names in the app's settings and accept the change on the installation.
