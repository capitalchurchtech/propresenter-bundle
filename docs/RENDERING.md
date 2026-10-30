# Drawing a slide the way ProPresenter does

Rules for previewing a ProPresenter 7 slide from the file alone. Each was found by drawing real
presentations (announcements, songs, sermons with Hebrew and Greek, a quiz deck built from photo
grids, holiday services with props, timers and video) and comparing against ProPresenter 21's own
pictures. No rule here depends on any church's theme.

The renderer itself is a prototype outside this package; these rules are what it must keep.

## Where the slide's look comes from

- **A slide as authored** is its `base_slide`: elements in `elements[]`, first in the list in front.
- **A Look can replace the look.** An audience Look (the workspace's `audience_looks`) gives each
  screen a theme slide (`template_document_file_path` + `template_slide_uuid`). On that screen the
  theme slide is drawn, and each placeholder box in it (element `info` bit 1, "template element")
  takes the words of the presentation slide, in the placeholder's own style.
- **What sets the Look.** A slide's action (`audience_look`), or a macro the slide fires that holds
  one. A song often starts with an intro slide whose macro sets the look for every slide after it,
  so the same words can be full-screen in one arrangement and lower thirds in another. The file
  alone does not say which Look is live: ask, or take it from the arrangement's first macro.
- **Library thumbnails ignore both the playlist's arrangement and the Look.** For the true output,
  compare against what the confidence monitor shows while the item plays from the playlist. A
  theme slide has its own picture (`/v1/theme/{name}/slides/{index}/thumbnail`), the reference for
  drawing a Look's theme; playlist items have theirs (`/v1/playlist/{id}/{index}/thumbnail/{cue}`).
- **ProPresenter's pictures can be stale.** Until its Media Manager has processed a slide's media
  (it can run for a long time on a large library), the API returns a placeholder icon in its place.
  The first request starts the loading; ask again. Missing pictures in ProPresenter's thumbnails are
  therefore not evidence of missing media: check the media files themselves.
- **Slide numbers follow the selected arrangement** (`selected_arrangement`), repeats included.
  Thumbnails and the live index count that way; slides the arrangement skips have no number.

## What is on screen: the media layer

A slide's own elements are only part of the output. The background is whatever the media layer holds
when the slide is shown, which can come from an earlier slide. Measured live on ProPresenter 21:

- **There is one media layer.** A slide's media action replaces what is there.
- `media.layer_type` 0 (background) **stays** until something replaces or clears it.
  `layer_type` 1 (foreground) **ends at the next slide**: the slide after it starts with an empty
  layer unless it brings its own media.
- A **clear** action with `target_layer` 0 (all) or 2 (media) empties the layer.
- **A slide's clears run before its media,** including clears inside a macro the slide fires
  (macros live in the workspace's `Configuration/Macros`; follow nested macros a few levels deep).
  So "clear, then show this picture" and "show this picture, then clear" both end with the picture.
- To preview a slide in context, walk the arrangement from its first slide, keeping that state.
- **An empty layer is black on the output.** A transparent area of a picture is black too. The
  checkerboard is only the editor's and the thumbnails' way of drawing transparency.
- **Thumbnails are darker than the source** (about 1.04 x - 15 per channel). Compare positions and
  shapes, not tone.

## CCLI notice

`Configuration/CCLI` holds the licence: `enable`, the licence number, `display_type` (0 first slide,
1 last slide, 2 first and last, 3 every slide) and a template element whose text box carries a
`ccli_text` data link. On the chosen slides of a song with CCLI data, that element is drawn on top.
Its words follow ProPresenter's `CCLIMessageFormat` preference (artist, then a "used with
permission" line, then the licence number); `${Artist}` is the song's `ccli.artist_credits`, not
`ccli.author`.

## Boxes

- **Draw order:** background media actions, then elements from the back of the list to the front,
  then any prop the slide triggers (its own slide, on top).
- **A text box with no words draws nothing**, its fill included (element `info` bit 2, "text
  element"). A shape with no text box role still draws its fill.
- **Hidden** elements are skipped. **Rotation** turns the box about its centre.
- **Fill** draws only when `fill.enable` is true; a fill colour without it is a leftover default.
  The same goes for **stroke** (`stroke.enable`) and shadows.
- **Shapes:** `path.shape.type` 1 rectangle, 2 ellipse, 8 custom. A custom path's points are
  fractions of the box; each segment is a cubic Bézier from one point's `q1` to the next point's
  `q0`. Clip the box to it.

## The line mask (the "tag behind each line")

`text_line_mask.enabled` turns a text box's fill into a background behind the words, not the box:

- `mask_style` 0: full width, 1: each line its own width, 2: the widest line's width for all lines.
- `width_offset` and `height_offset` grow the mask around the words (half on each side). Each tag
  is the font's own height (ascent + descent) plus `height_offset`, and moves with its line; the gap
  between tags is the line pitch minus that.
- The text **margins** (`text.margins`) place the words inside the box; the mask hugs the words and
  ignores the margins. Mixing the two makes every tag too large. The offsets grow the tag *out*
  from the words; they do not push the words in, so a tag can reach past the margins.
- `vertical_offset` moves the tag, not the words, by that many points; positive is down.
- **A tag never reaches past its box.** Where the words plus the offsets would cross the box's edge,
  the tag is cut at the edge (a right-aligned title with a small right margin and a wide offset has
  its tag end flush with the box, the words still where the margin put them).
- A block tag (styles 0 and 2) covers the first line's full height, even when the line spacing is
  under 1: the room a tight multiple takes from the first line goes inside the tag, above the words.
  Over 1 it is the other way: the extra room a multiple adds sits above each line's glyphs, and
  above the first line it is **outside** the tag. A one-line 40 pt label at 1.2 spacing with a 20 pt
  height offset has a 68 px tag (48 + 20), not 77.6; counting the extra makes the tag too tall
  and, once the box centres it, sets the words about 5 px low.
- Without the line mask, an enabled fill covers the whole box.

## Text

- The words are the RTF; the box's `attributes` (font, `text_solid_fill`, `paragraph_style`,
  `capitalization`) supply what the RTF leaves out. Sizes are points equal to pixels on the slide.
- **RTF details that matter:** `\'hh` is one Windows-1252 byte (curly quotes, dashes); `\uN` is
  UTF-16 (negative numbers wrap); a bare newline is formatting. Control words can be mixed case
  (`\CocoaLigature0`). `\expndtwN` is letter spacing in twips (N/20 points). `\ul` / `\ulnone`
  underline. `\qc` `\qr` `\qj` align.
- **Breaks.** A backslash followed by a newline is how Cocoa writes Return: a **paragraph** break.
  `舲` (U+2028, Shift-Return) breaks the line inside the paragraph; `舳` is a paragraph
  break. Lyrics use U+2028 a lot; drawn as a character, the two lines run together and rewrap.
- **Paragraph properties are per paragraph.** Line spacing (`\slN\slmult1`) and alignment carry
  into the next paragraph until `\pard` resets them, so one box can hold a 1.3-spaced paragraph
  between two at 1.0. When the RTF never sets `\sl`, the box's `paragraph_style` multiple applies.
- **More RTF that shows:** `\strokewidthN` is an outline N/20 percent of the font size wide
  (negative: outline and fill, positive: outline only, hollow letters), in colour `\strokecN`; the
  box's `attributes.stroke_width` holds the same N/20. `\upN` / `\dnN` raise or lower by N
  half-points (verse numbers). `\cbN` is a colour behind the letters. `\strike` strikes through.
- **Shrink to fit.** `text.scale_behavior` 2 scales every size in the box down by one factor until
  the words fit inside the margins; 3 scales up until they fill it; 4 either; 1 (adjust the
  container's height) draws as 0. The RTF keeps the original sizes. ProPresenter stores the factor
  it last used in `custom_attributes` (`font_scale_factor`, with `original_font_size`), but that
  value can be stale after the words change, so compute it: the largest factor at which the words
  fit, found by bisection, lands within about 1% of ProPresenter's.
- **Tabs** go to the paragraph's next stop (`\txN`, twips, counted from the box's left edge), then
  every `paragraph_style.default_tab_interval` after the last stop. Scripture set as poetry indents
  its lines with one or two tabs; a tab that lands exactly on a stop moves on to the next one.
- **Indents** are per paragraph: `\liN` left, `\fiN` first line (negative is a hanging indent),
  `\riN` right, all twips. **Numbered and bulleted lists** carry their marker as literal text
  (`{\listtext <tab>1.<tab>}`) with a hanging indent and stops; the list table itself is an
  ignorable `{\* ...}` group nested several levels deep, and must be skipped whole or its
  definitions print as stray characters.
- **Line height in points.** `\slN` without `\slmult1` is "at least N twips" (negative: exactly);
  only with `\slmult1` is it the multiple N/240.
- **Line pitch** is 1.2 x size x `line_height_multiple`, plus `paragraph_style.line_spacing` (points
  added below every line; RTF `\slleadingN`, in twips). RTF `\slN\slmult1` is the multiple N/240.
  A multiple under 1 packs only the lines after the first: the first keeps its full height.
- **Glyphs sit at the bottom of each line**, one font descent up and above any extra spacing; a
  browser centres them in the line box instead. Move each line by (line height - (ascent + descent))
  / 2 - extra spacing, with the font's own ascent and descent. Without this, titles set tighter than
  1.0 overlap their own next line.
- **Lines are measured from their own runs.** A line's height comes from the fonts and sizes on it,
  never from a default. (In a browser, give each paragraph the font and size of its first run: the
  paragraph's strut otherwise sits on the baseline and stretches a tightly spaced 200 pt line.)
- **A typed line break at the very end** is an empty last line and takes its height (a
  bottom-aligned title with one sits a whole line higher).
- **Vertical alignment** 0 top, 1 middle, 2 bottom. Titles are often bottom-aligned.
- **Capitalisation** 1 is all caps: the whole box from the box attributes, or only a range from
  `custom_attributes` (`range.start`/`range.end`, UTF-16 offsets into the plain text, end
  exclusive, each paragraph break one character). A caps range on a byline does not capitalise the
  title above it.
- **Text tied to the slide label** (`data_links` with `slide_Label_Text`) shows the slide's label,
  whatever words the file still holds. **Timer text** (`timer_text`) shows the timer's time.
- **Writing words back into RTF** (a slide label, a template's placeholder): anything outside ASCII
  goes in as `\uc0\uN` (UTF-16 code units), never as raw bytes, or accented letters come out garbled.
- **System fonts** (`.AppleSystemUIFont`, `.SFNS...`) are the platform's UI face: draw with the
  system UI font, not a fallback serif.
- **Fonts** are named by PostScript name; draw with the installed font of that name. A legacy font
  that maps accented letters onto ordinary characters (some transliteration faces) only reads
  correctly in that font.

## Pictures and video

- Media URLs: prefer the relative `local.path` under root 10 (the workspace's Media folder); the
  absolute path is the exporting machine's.
- **Placement** (`image.drawing`): crop first, with `crop_insets` in the picture's own pixels when
  `crop_enable`; then `scale_behavior` 0 fit, 1 fill, 2 stretch, 3 custom: the cropped picture
  stretched into `custom_image_bounds` (relative to the box). Clip to the box and its shape.
- **Background media actions** are placed by the same rules, the box being the whole slide. The
  file stores no default: a missing `scale_behavior` is 0, **fit**, not fill. A portrait picture
  sits in the middle with bars; `is_blurred` fills the bars with a blurred copy. (Library
  thumbnails draw those bars as diagonal stripes, and draw data-linked text, such as the slide
  label, as the box's stored words.)
  A PNG background can be transparent: show a checkerboard behind it, as ProPresenter does
  (#222 and #0a0a0a, 16 px squares: a dark tag is invisible on a lighter one).
- **Video**: draw the first frame, as ProPresenter's own thumbnail does (`thumbnail_position` -1).
  A system thumbnailer that picks a frame from the middle scores far worse on looping backgrounds.
- **Shapes** all store their outline as points, triangles and arrows included; draw any type other
  than rectangle and ellipse from its points.
- **Compress gently.** Slide backgrounds are often dark, low-contrast textures (fine lines, grain).
  An aggressive lossy encode turns them into flat blocks that read as a different picture; keep a
  quality where a 1 px line survives at preview size.
- **Missing media** is a finding, not a drawing error: ProPresenter shows a placeholder icon, and a
  bundle can be exported without media it points at.
