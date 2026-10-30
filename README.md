# propresenter-bundle

Not on npm, and marked `private` so it can't be published there by accident. Install it from a
tag of this repository, for example `npm install github:<owner>/propresenter-bundle#v0.1.0`.

Reads, checks and edits ProPresenter 7 presentations (`.pro`) and bundles (`.probundle`) in plain
Node.js, with no build step. Used by Refrain and by an announcements exporter, so the same tested code
runs in both.

**Unofficial.** Renewed Vision does not publish ProPresenter's file format. This uses the community
schema from [greyshirtguy/ProPresenter7-Proto](https://github.com/greyshirtguy/ProPresenter7-Proto)
(MIT, in `proto/` with its own licence), which is a version behind ProPresenter 21. Nothing here is
supported by Renewed Vision, and a ProPresenter update can change what these files hold. ProPresenter is a
trademark of Renewed Vision; this project is not affiliated with or endorsed by them, and uses the name only
to say which files it reads.

## What it does

- **Open** a `.pro` or `.probundle` (`readPresentationFile`): groups, slides, labels, words, boxes,
  media and macros, in ProPresenter's order.
- **Diff** two versions of a presentation (`diffModels`), for example a file as imported against the
  same file after an operator's hand fixes. Every difference is something the import could have done.
- **Check** a file (`checkFile`): fields the schema cannot read, a re-save that would change the
  presentation, missing media, macros the workspace no longer has, text predicted to overflow its box,
  capitals that stop short of the words, a predicted one-word last line, objects out of the house order.
- **Edit** the way ProPresenter writes: `setText` rebuilds a box's RTF and its font ranges together and
  keeps its capitalisation; `setImage`, `tidyElements`, `fitSpeakerBox`, `tidyActions`, `freshCopy`.
- **Zip** bundles (`readBundle`, `writeBundle`). ProPresenter's own zips have a central directory 98
  bytes too long, so they are read by their local headers.
- **Build a show from a script** (`propresenter-bundle/script`). `parseScript` reads a play's script
  (`NAME: words`, `[directions]`, `{tech notes}`, `[PICTURE: x.jpg]`, a screenplay's text) into beats;
  `buildScriptBundle` makes a `.probundle` from them by copying the booth's own master slides, named in
  a church's recipe (`loadScriptType`), and replacing only words, labels, label colours and pictures.
  Macros are copied by id and never renumbered. A cue slide before anything the sound desk does is
  called VIDEO or AUDIO (`cueStyle: "soundboard"`), or `CUE: LIGHTS + MUSIC` (`cueStyle: "cue"`).
  `playScript`, `checklist` and `questions` read the beats back for people before anything is built.

## Things to know before trusting it

- **A decode silently drops fields the schema lacks.** `findUnknownFields` walks the raw bytes against
  the schema; `decodePresentation` carries anything unknown through as raw bytes so it is written back.
- **Do not check a library file by byte round trip.** ProPresenter's own saves re-encode about a byte
  longer per slide through this schema while decoding identically. `checkPresentationBytes` checks
  that nothing is unread and that decode, encode, decode gives the same presentation.
- **Layout predictions are only as good as the font table.** The package ships no real font metrics:
  those describe fonts a church licenses. Pass your own table (`tableMetrics`) built from your installed
  fonts. Without one, `fallbackMetrics` is a rough guess, and `checkFile` says so on every layout finding.
  The wrap rules (5px inset a side, lines 1.2 x size apart) were measured on Helvetica Neue in
  ProPresenter 21 on macOS; other fonts and versions are unverified.
- **Which box is which is a church's own rule.** `createRoles(rules)` takes the fonts and shapes that
  mean title, subtitle, link, QR code and so on in your theme. The defaults are plain.
- **Line-break rules are English** (`englishBreaks`). Pass another table to `createGeometry`.
- **Never edit a library file in place.** ProPresenter holds library files open and overwrites changes
  made under it. Edit a copy and write a new file.

## No church's data, ever

This repository holds no presentation, theme, picture, font or name from any church. Tests use
fixtures that `scripts/make-fixtures.js` builds from invented words, and `test/privacy-guard.test.js`
fails the build if:

- any `.pro`, `.probundle`, `.protheme`, `.pb`, picture or font file appears outside `test/fixtures/`,
- `test/fixtures/` holds anything the script does not make, byte for byte,
- any string from your private list appears anywhere. The list is yours and stays out of the repo: one
  string per line in `~/.config/propresenter-bundle/private-strings.txt`, or the file named by
  `PROBUNDLE_PRIVATE_STRINGS`. Without a list that one test is skipped, and says so.

## Use

```js
import { readPresentationFile, checkFile, diffModels } from "propresenter-bundle";

const { model } = readPresentationFile(fs.readFileSync("Example.pro"));
const { findings } = checkFile(fs.readFileSync("Example.probundle"));
```

Node 20 or later. `npm test` runs the tests; `npm run fixtures` rebuilds the fixtures.

## Licence

MIT. The schema in `proto/` is MIT, copyright greyshirtguy, copied without change. `src/proto.json` is
that schema compiled, plus two fields this package adds (its own work, under its own licence) and Google's
standard protobuf types (BSD-3-Clause, copyright Google). `NOTICE` has the details and Google's notice.
