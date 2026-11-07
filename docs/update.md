# Update

How to bring your own Seluna instance to the latest release. Everything happens in GitHub's web interface; you type no command.

The update applies the latest full release of [`LarsLaskowski/Seluna`](https://github.com/LarsLaskowski/Seluna) to `main` of your copy as one new commit and pushes it without force. Your own changes stay. Cloudflare's Workers Builds then builds and deploys the new commit like any other push to `main`. The workflow reads only the public original repository and runs no code of the release.

## Start the update

1. Open your copy on GitHub and go to the workflows of the repository, where GitHub lists them and their runs.
2. In the list of workflows select **Update Seluna**. If GitHub asks you to enable workflows for your copy, enable them first (see _Permissions_); if **Update Seluna** is still missing, see _Add the workflow to an older copy_.
3. Run the workflow by hand on the branch `main` ([documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)).
4. Open the run when it appears. A green run says `Updated Seluna from vA.B.C to vX.Y.Z.`; `Seluna is already on the latest release` means there is nothing to do. A red run stops before it changes anything and says why. The sections below belong to the messages.

Only one update runs at a time; start it again when a run says that `main` changed during the update.

## Add the workflow to an older copy

A copy made from version 0.4.0 or earlier has no **Update Seluna** workflow. Add it once by hand; it is one file.

1. Open the [latest release](https://github.com/LarsLaskowski/Seluna/releases/latest) of the original repository, select its tag (for example `v0.5.0`) and switch to that version. Open `.github/workflows/update.yml` there, the version of the latest release and not the one of `main`, and copy its raw text ([documentation](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files)).
2. In your copy create a new file named `.github/workflows/update.yml` (typing `/` in the name creates the folders) ([documentation](https://docs.github.com/en/repositories/working-with-files/managing-files/creating-new-files)).
3. Paste the text and commit the file directly to `main`.
4. Open the workflows of your copy; **Update Seluna** is listed now. Continue with _Start the update_.

GitHub lets you create a workflow file in the web interface, because you do it as yourself. The update workflow itself can never do this (see _Workflow files_).

## Conflicts

A conflict means you changed lines of a file that the release changed as well. The run stops, changes nothing and lists the files, for example `The update to v0.6.0 conflicts with changes in your copy: wrangler.jsonc.` To resolve it:

1. In your copy open each listed file in the web interface and edit it ([documentation](https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files)), changing the conflicting lines so that they read as in the release. The release's file is in the original repository at the tag named in the message.
2. Commit the change directly to `main`.
3. Run the workflow again (_Start the update_). It now finds no conflict and applies the release.
4. Afterwards apply your own change again in the updated file, as a new commit.

If a release removes a file that you changed, the run reports it as a conflict as well; delete that file in your copy.

If a release renames a file that you changed, the run names the old path. Deleting that file or editing it to match the release does not resolve this conflict. Instead, change the file back so that it reads exactly as it did before your own changes: as in the release your copy was last updated to (the version in the last `Update Seluna to` commit of your copy), or, if the workflow has never updated your copy, as in the version of the original repository your copy was made from. Run the workflow again, and afterwards apply your change to the file under its new name.

## New major version

From version 1.0.0 on, a release with a new major number can change how Seluna works. The run then stops with `Release vX.0.0 is a new major version` and changes nothing. Read the release notes of that release, then run the workflow again with **Allow a new major version** checked. The update from a `0.x` version to `1.0.0` needs no checkbox.

## After the update

1. Wait for the build: in the Cloudflare dashboard open your Worker and look at its builds and their log ([documentation](https://developers.cloudflare.com/workers/ci-cd/builds/)). The new version is live when the build succeeds; `https://<worker>.<your-subdomain>.workers.dev/health` answers with it.
2. Check that the deploy command in the Worker's build settings is still `npm run deploy` (see [Setup, step 3](setup.md#3-deploy-to-cloudflare)), so that the release's database migrations are applied. If the build fails after an update, its log names the reason; the update commit is an ordinary commit that you can revert on GitHub.
3. Your instance keeps its own names. The update leaves the package name (in `package.json` and `package-lock.json`), the Worker name and the database name (in `wrangler.jsonc`) of your copy as they are. This covers every `name` or `database_name` line of that file whose value is the one the original repository had when your copy was built, also a nested one, not only the first. If a release renames the package, the Worker or the database away from that value, the update replaces your name with the release's new one; set your own name again by hand afterwards in the web interface (as in _Conflicts_).

## Permissions

The run needs to push to `main` of your copy. If it ends with `GitHub refused the push: the workflow may not write to this repository`:

1. In the settings of your copy, open the settings for GitHub's workflows ([documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)).
2. Give the workflow token permission to read and write, and save.
3. Make sure that workflows are allowed to run in this repository and enabled for your copy (a new copy can ask you to enable them once).
4. If `main` has a branch protection rule or a ruleset that requires pull requests or blocks pushes ([documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)), allow the update workflow to push to `main`, or lift the rule for the update; the workflow never pushes anywhere else and opens no pull request.

Then run the workflow again.

## New GitHub permissions

A release can ask more of the GitHub App, for example read access to Issues and Contents and the events for issues, comments, forks and stars. An app you already created keeps its old permissions until you accept the new ones on GitHub; until then those events are not delivered. After an update, open the setup page (`/setup`) and read the status section: **Missing on the app:** names the permissions and events the app lacks. Select **Add them in the app's settings on GitHub**, add what is named and save. GitHub then asks each account the app is installed on to accept the change: in the **Installations:** list, an entry marked **missing:** carries the link **Review and accept on GitHub**; open it and accept the new permissions. Reload the status page: when nothing is missing, the **Missing on the app:** text and the suffixes are gone. Notifications keep working in the meantime, because Seluna asks GitHub for tokens that carry only the permissions it needs.

## Workflow files

Your copy keeps every file under `.github/workflows/` as it is. GitHub does not let a workflow change workflow files with its own token, so a push that did would be refused. The update therefore applies everything else and, when the release changed a workflow file your copy has, lists it in the summary of the run: `The release changed these workflow files, which your copy keeps as they are: ...`.

To take one over, copy it by hand:

1. Open the file in the original repository at the release's tag, for example `.github/workflows/update.yml`, and copy its raw text ([documentation](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files)).
2. In your copy open the file with the same path and edit it ([documentation](https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files)). If your copy has not got it, create it as in _Add the workflow to an older copy_.
3. Replace the text with the copied one and commit the change directly to `main`.

Take `update.yml` over first when it is listed: it is the file that applies updates. It changes rarely and stays free of actions, so the copy you have keeps working with later releases until you replace it. The other workflow files only serve the original repository's own checks and releases, so keeping them is safe: your copy works with its old ones, and you take one over only if you want to.

## Unknown base

An update needs to know which Seluna version your copy was built from, to apply only what the release changed. The run finds it from its own last update, from the history your copy shares with the original repository, or from the state of the button's first commit. When none of them matches, it stops with `The update cannot tell which Seluna version your copy was built from` and changes nothing. This happens, for example, if you replaced `main` with a history that has no relation to a release, or rewrote the first commit.

The workflow never guesses a version, as that could silently keep or revert code. You can:

- apply the release by hand: in the original repository open the release, compare its files with your copy's and edit them in your copy, keeping your `wrangler.jsonc` values; or
- create a new copy with the **Deploy to Cloudflare** button and enter your values again (see [Setup, step 3](setup.md#3-deploy-to-cloudflare)); or
- open an issue in the original repository with the message and the first commit of your copy.
