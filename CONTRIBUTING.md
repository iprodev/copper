# contributing to fetchr
if you're reading this, you are probably interested in contributing to fetchr, which we are very thankful for :3

this document serves as a guide to help you make contributions that we can merge into the fetchr codebase.

## translations
translations live in the [`web/i18n`](/web/i18n) directory, one folder per language. to add or improve a translation, open a pull request with your changes.

thank you for showing interest in making fetchr more accessible around the world, we really appreciate it! here are some guidelines for how a fetchr translation should look:

- fetchr's writing style is informal. please do not use formal language, unless there is no other way to express the same idea of the original text in your language.
- all fetchr text is written in lowercase. this is a stylistic choice, please do not capitalize translated sentences.
- do not translate the name "fetchr".
- **please don't translate fetchr into languages which you are not experienced in.** we would prefer fetchr to be translated by humans, not computers.

to add a new language, copy the `web/i18n/en` folder, translate the strings, and add the language to `web/i18n/languages.json`.

## adding features or support for services
before putting in the effort to implement a feature, it's worth considering whether it would be appropriate to add it to fetchr. the fetchr api is built to assist people **only with downloading freely accessible content**. other functionality, such as:
- downloading paid / not publicly accessible content
- downloading content protected by DRM
- scraping unrelated information & exposing it outside of file metadata

will not be reviewed or merged.

if you plan on adding a feature or support for a service, but are unsure whether it would be appropriate, it's best to open an issue and discuss it beforehand.

## git
when contributing code to fetchr, there are a few guidelines in place to ensure that the code history is readable and comprehensible.

### clean commit messages
internally, we use a format similar to [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) - the first part signifies which part of the code you are changing (the *scope*), and the second part explains the change. for inspiration on how to write appropriate commit titles, you can take a look at the [commit history](https://github.com/iprodev/fetchr/commits/).

the scope is not strictly defined, you can write whatever you find most fitting for the particular change. suppose you are changing a small part of a more significant part of the codebase. in that case, you can specify both the larger and smaller scopes in the commit message for clarity (e.g., if you were changing something in internal streams, the commit could be something like `api/stream: fix object not being handled properly`).

if you think a change deserves further explanation, we encourage you to write a short explanation in the commit message, which will save both you and us time having to enquire about the change, and you explaining the reason behind it.

if your contribution has uninformative commit titles, you may be asked to interactively rebase your branch and amend each commit to include a meaningful title.

### clean commit history
if your branch is out of date and/or has some merge conflicts with the `current` branch, you should **rebase** it instead of merging. this prevents meaningless merge commits from being included in your branch, which would then end up in the fetchr git history.

if you find a mistake or bug in your code before it's merged or reviewed, instead of making a brand new commit to fix it, it would be preferable to amend that specific commit where the mistake was first introduced. this also helps us easily revert a commit if we discover that it introduced a bug or some unwanted behavior.
- if the commit you are fixing is the latest one, you can add your files to staging and then use `git commit --amend` to apply the change.
- if the commit is somewhere deeper in your branch, you can use `git commit --fixup=HASH`, where *`HASH`* is the commit you are fixing.
    - afterward, you must interactively rebase your branch with `git rebase -i current --autosquash`.
      this will open up an editor, but you don't need to do anything else except save the file and exit.
- once you do either of these things, you will need to do a **force push** to your branch with `git push --force-with-lease`.

## testing
before opening a pull request, make sure that checks pass locally:
- api unit tests: `pnpm run --prefix api test:unit` (no network access needed)
- web lint & type check: `pnpm run --prefix web lint` and `pnpm run --prefix web check`

if you're fixing a bug in the api, please add a unit test for it in `api/tests/`.
