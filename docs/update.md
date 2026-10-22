# Update

How to bring your own Seluna instance to the latest release. Everything happens in GitHub's web interface; you type no command.

The update applies the latest full release of [`LarsLaskowski/Seluna`](https://github.com/LarsLaskowski/Seluna) to `main` of your copy as one new commit and pushes it without force. Your own changes stay. Cloudflare's Workers Builds then builds and deploys the new commit like any other push to `main`. The workflow reads only the public original repository and runs no code of the release.

## Start the update

1. Open your copy on GitHub and select **Actions**.
2. In the list on the left select **Update Seluna**. If it is missing, see _Add the workflow to an older copy_.
3. Select **Run workflow**, keep the branch `main` and select **Run workflow** again.
4. Open the run when it appears. A green run says `Updated Seluna from vA.B.C to vX.Y.Z.`; `Seluna is already on the latest release` means there is nothing to do. A red run stops before it changes anything and says why. The sections below belong to the messages.

Only one update runs at a time; start it again when a run says that `main` changed during the update.

## Add the workflow to an older copy

A copy made from version 0.4.0 or earlier has no **Update Seluna** workflow. Add it once by hand; it is one file.

1. Open [`.github/workflows/update.yml`](https://github.com/LarsLaskowski/Seluna/blob/main/.github/workflows/update.yml) in the original repository and select **Copy raw file**.
2. In your copy select **Add file**, **Create new file**, and type `.github/workflows/update.yml` as the name (typing `/` creates the folders).
3. Paste the text, select **Commit changes** and commit to `main`.
4. Open **Actions** in your copy; **Update Seluna** is listed now. Continue with _Start the update_.

GitHub lets you create a workflow file in the web interface, because you do it as yourself. The update workflow itself can never do this (see _Workflow files_).

## Conflicts

A conflict means you changed lines of a file that the release changed as well. The run stops, changes nothing and lists the files, for example `The update to v0.6.0 conflicts with changes in your copy: wrangler.jsonc.` To resolve it:

1. In your copy open each listed file, select **Edit this file** (the pencil) and change the conflicting lines so that they read as in the release. The release's file is in the original repository at the tag named in the message.
2. Select **Commit changes** to `main`.
3. Run the workflow again (_Start the update_). It now finds no conflict and applies the release.
4. Afterwards apply your own change again in the updated file, as a new commit.

If a release renames or removes a file that you changed, the run reports it as a conflict as well; take over the release's version of that file in the same way.

## New major version

From version 1.0.0 on, a release with a new major number can change how Seluna works. The run then stops with `Release vX.0.0 is a new major version` and changes nothing. Read the release notes of that release, then run the workflow again with **Allow a new major version** checked. The update from a `0.x` version to `1.0.0` needs no checkbox.

## After the update

1. Wait for the build: in the Cloudflare dashboard open **Workers & Pages**, your Worker and **Deployments**. The new version is live when the build succeeds; `https://<worker>.<your-subdomain>.workers.dev/health` answers with it.
2. Check that the **Deploy command** under **Settings** and **Build** is still `npm run deploy` (see [Setup](setup.md)), so that the release's database migrations are applied. If the build fails after an update, its log names the reason; the update commit is an ordinary commit that you can revert on GitHub.
3. Your instance keeps its own names. The update leaves the Worker name, the database name and the package name of your copy as they are (the lines `name` and `database_name` in `package.json` and `wrangler.jsonc` keep your values). The same happens to a further line with the same value elsewhere in `wrangler.jsonc`. If a release itself renames the package or the Worker, your name stays; change it by hand if you want the new one.

## Permissions

The run needs to push to `main` of your copy. If it ends with `GitHub refused the push: the workflow may not write to this repository`:

1. In your copy select **Settings**, **Actions**, **General**.
2. Under **Workflow permissions** choose **Read and write permissions** and select **Save**.
3. Under **Actions permissions** make sure that actions and workflows are allowed to run in this repository, and under **Actions** that workflows are enabled for your copy (a new copy can ask you to enable them once).
4. If `main` has a branch protection rule or a ruleset that requires pull requests or blocks pushes, allow GitHub Actions to push to `main`, or lift the rule for the update; the workflow never pushes anywhere else and opens no pull request.

Then run the workflow again.

## Workflow files

Your copy keeps every file under `.github/workflows/` as it is. GitHub does not let a workflow change workflow files with its own token, so a push that did would be refused. The update therefore applies everything else and, when the release changed a workflow file your copy has, lists it in the summary of the run: `The release changed these workflow files, which your copy keeps as they are: ...`.

To take one over, copy it by hand:

1. Open the file in the original repository at the release's tag, for example `.github/workflows/update.yml`, and select **Copy raw file**.
2. In your copy open the file with the same path and select **Edit this file**. If your copy has not got it, use **Add file** and **Create new file** as in _Add the workflow to an older copy_.
3. Replace the text with the copied one and select **Commit changes** to `main`.

Take `update.yml` over first when it is listed: it is the file that applies updates. It changes rarely and stays free of actions, so the copy you have keeps working with later releases until you replace it. The other workflow files are optional; your copy works with its old ones.

## Unknown base

An update needs to know which Seluna version your copy was built from, to apply only what the release changed. The run finds it from its own last update, from the history your copy shares with the original repository, or from the state of the button's first commit. When none of them matches, it stops with `The update cannot tell which Seluna version your copy was built from` and changes nothing. This happens, for example, if you replaced `main` with a history that has no relation to a release, or rewrote the first commit.

The workflow never guesses a version, as that could silently keep or revert code. You can:

- apply the release by hand: in the original repository open the release, compare its files with your copy's and edit them in your copy, keeping your `wrangler.jsonc` values; or
- create a new copy with the **Deploy to Cloudflare** button and enter your values again (see [Setup](setup.md)); or
- open an issue in the original repository with the message and the first commit of your copy.
