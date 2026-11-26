# yt-dlp's challenge solver

`core.min.js` and `lib.min.js` are [yt-dlp/ejs](https://github.com/yt-dlp/ejs) 0.8.0,
copied unchanged from the `yt-dlp-ejs` package on PyPI (`yt_dlp_ejs/yt/solver/`).
they solve the "n" and signature challenges of youtube's player scripts, and are
used by `../youtube-tv.js`.

licenses: the solver is released into the public domain (Unlicense, see `LICENSE`).
`lib.min.js` bundles [meriyah](https://github.com/meriyah/meriyah) (ISC) and
[astring](https://github.com/davidbonnet/astring) (MIT); their license texts are
at the top of that file.

to update, take both files from a newer release of the same package and check
that `getTvUrls` still works for videos that need it (e.g. 9bZkp7q19f0).
