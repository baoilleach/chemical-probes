# Visual Framework assets

`styles.css` is the Visual Framework 2.5.30 CSS rollup from
`https://assets.emblstatic.net/vf/v2.5.30/css/styles.css`. Its four normal-weight
IBM Plex Sans font URLs were changed to the local WOFF2 files below.
The app uses its static CSS components and does not load the VF JavaScript rollup.

The four IBM Plex Sans WOFF2 files in `fonts/` come from the paths used by the
official VF rollup, pinned to `@ibm/plex@4.0.2`. The vendored CSS points to
these local files so fonts work without a CDN request. VF is Apache 2.0 licensed
(`LICENSE`), and IBM Plex Sans is under the SIL Open Font License (`fonts/LICENSE.txt`).
