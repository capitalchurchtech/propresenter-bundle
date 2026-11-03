# propresenter-bundle

Not on npm, and marked `private` so it can't be published there by accident. Install it from a
tag of this repository, for example `npm install github:<owner>/propresenter-bundle#v0.1.0`.

Reads, checks and edits ProPresenter 7 presentations (`.pro`), bundles (`.probundle`) and themes
(`.protheme`) in plain Node.js, with no build step. Used by Refrain and by an announcements exporter, so the same tested code
runs in both.

**Unofficial.** Renewed Vision does not publish ProPresenter's file format. This uses the community
schema from [greyshirtguy/ProPresenter7-Proto](https://github.com/greyshirtguy/ProPresenter7-Proto)
(MIT, in `proto/` with its own licence), its `autogen-proto` generated from ProPresenter 21.4. A newer
ProPresenter (22 is in beta) can write fields it lacks: those are counted, a file holding them is read but
not changed, and `npm run schema` recompiles `proto/` when upstream catches up. Nothing here is
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
- **Themes** (`readThemeFile`): each theme slide, its boxes with the id that names each one, the macros it
  fires, and the pictures in its Assets. `renameElement` renames a box in a theme or a presentation;
  `writeTheme` writes a changed copy with every picture exactly as it was, after the same check a
  presentation gets, and refuses a theme holding anything the schema can't read.
  `themeSlideAsCue` makes a theme slide a presentation slide: its boxes and actions, and its own pictures
  (kept relative to the theme) pointed at the workspace's media and returned to go into the bundle.
- **The slide editor's box settings** (`setTextColor`, `setAlignment`, `setVerticalAlignment`, `setTextFit`,
  `setCapitals`, `setFont`, `setBoxStyle`, `arrangeBox`): each written where ProPresenter keeps it, in both
  places where it keeps two. Checked against how ProPresenter 21 wrote real files and re-read through the
  schema; not yet imported into ProPresenter and looked at. A font's bold is guessed from its name
  (`boldOf`), which is wrong for some faces (Georgia-Italic's bold is Georgia-BoldItalic).
- **Line spacing and notes** (`setLineSpacing`, `notesOf`, `setNotes`): line spacing as ProPresenter 21 writes it
  (`\sl` with `\slmult1` on every paragraph, and the paragraph style's multiple), and a slide's notes as text.
- **Linked boxes.** A box can take its words, colour, picture or visibility from elsewhere: the slide's
  label, a timer, the clock, another slide. `linksOf` names each link in plain words, and a box linked to
  its own slide's label reads as the label (`showsOwnLabel`), since that is what ProPresenter shows.
- **Read a playlist file** (`readPlaylistFile`, `.proplaylist`): its playlists, each item's kind, file and
  arrangement name, and the presentations and media it carries. Read only; not yet tried on a real one.
- **Read a workspace** (`readWorkspacePart`), read only: macros and their collections, Looks and screens,
  labels, groups, props, messages, timers, stage layouts, clear groups, and the playlist library as a tree.
  These are the files in a workspace's `Configuration` and `Playlists` folders; ProPresenter's database is
  never read. A field a newer ProPresenter added is counted, and the rest still read.
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
- **A changed theme has not yet been imported into ProPresenter here.** It is written as a copy and
  passes the same check as a presentation, but whether ProPresenter keeps a renamed box's link to the
  presentations that use the theme is untested. Try one on a copy of the library first.
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

Node 20 or later. `npm test` runs the tests; `npm run fixtures` rebuilds the fixtures. The fixtures ship
with the package (`test/fixtures/`), so a project using it can test against the same invented show.

## Licence

MIT. The schema in `proto/` is MIT, copyright greyshirtguy, copied without change. `src/proto.json` is
that schema compiled, with one field kept in this package's own form (its own work, under its own licence),
and Google's standard protobuf types (BSD-3-Clause, copyright Google). `NOTICE` has the details and Google's
notice.
