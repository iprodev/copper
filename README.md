<div align="center">
    <br/>
    <p>
        <img src="web/static/favicon.png" title="fetchr" alt="fetchr logo" width="100" />
    </p>
    <p>
        save what you love, without the nonsense
        <br/>
        <a href="https://fetchr.dignitydash.com">
            fetchr.dignitydash.com
        </a>
    </p>
    <br/>
</div>

fetchr is a media downloader that respects you. it's friendly, efficient, and doesn't have ads, trackers, paywalls or other nonsense.

paste the link, get the file, move on. that simple, just how it should be.

### fetchr monorepo
this monorepo includes source code for api, frontend, and related packages:
- [api tree & readme](/api/)
- [web tree & readme](/web/)
- [packages tree](/packages/)

it also includes documentation in the [docs tree](/docs/):
- [how to run a fetchr instance](/docs/run-an-instance.md)
- [how to protect a fetchr instance](/docs/protect-an-instance.md)
- [fetchr api instance environment variables](/docs/api-env-variables.md)
- [fetchr api documentation](/docs/api.md)

### ethics
fetchr is a tool that makes downloading public content easier. it takes **zero liability**.
the end user is responsible for what they download, how they use and distribute that content.
fetchr never caches any content, it [works like a fancy proxy](/api/src/stream/).

fetchr is in no way a piracy tool and cannot be used as such.
it can only download free & publicly accessible content.
same content can be downloaded via dev tools of any modern web browser.

### contributing
if you're considering contributing to fetchr, first of all, thank you! check the [contribution guidelines here](/CONTRIBUTING.md) before getting started, they'll help you do your best right away.

### based on cobalt
fetchr is a modified version of [cobalt](https://github.com/imputnet/cobalt), an open source media downloader made by [imput](https://imput.net/).
huge thanks to the cobalt team and its contributors for their amazing work!

fetchr is not affiliated with or endorsed by imput or the cobalt project.
all cobalt branding has been removed from this repository and replaced with original fetchr branding.

### licenses
for relevant licensing information, see the [api](api/README.md) and [web](web/README.md) READMEs.
unless specified otherwise, the remainder of this repository is licensed under [AGPL-3.0](LICENSE).
