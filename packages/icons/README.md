# `@nebulahome/icons`

The icons that ship with the platform, and the reader that turns an uploaded SVG into one.

Every icon the platform shows - a device's, an area's, the interface's own chrome - is an **id
in one catalogue** ([ARCHITECTURE.md §8.5](../../../ARCHITECTURE.md#85-icons)). This package is
the built-in half of it: the drawings that are there before anybody has signed in, installed
with the platform, so no icon ever needs the internet. The owner's half - custom icons, and
built-in ones drawn afresh - lives in `registry.icons` and is laid over this one by `api`.

```
catalogue.json      the platform's own ids, each pointing at a lucide drawing or shipping one
src/builtin.ts      loads the built-in set: catalogue.json first, then every lucide icon
src/catalogue.ts    IconCatalogue: built-in + rows, merged, searched, read by id
src/svg.ts          parseIconSvg, suggestIconId - pure, shared by browser and server
```

The package has two entry points on purpose. `@nebulahome/icons` reads `lucide-static` from
disk and is for the server; `@nebulahome/icons/svg` touches no file and is what the browser
imports to preview an upload before sending it.

## What an icon is

An icon is a **node** and a **frame**. The node is the flat list of SVG elements the drawing is
made of, as `[tag, attributes]` pairs - the shape `lucide-static/icon-nodes.json` ships in:

```json
[
  ["circle", { "cx": "12", "cy": "12", "r": "10" }],
  ["path", { "d": "m9 12 2 2 4-4" }]
]
```

The frame is the square of the drawing's own coordinates to show, `{ x, y, size }`: `{0, 0, 24}`
for every lucide icon, whatever the upload said for a custom one. The interface draws the node
inside its own `<svg viewBox="x y size size">`, in `currentColor`, with a stroke scaled to the
frame (`1.75 · size / 24`), so a custom icon framed at 512 units draws with the same stroke as a
shipped one and carries nothing of its own - no colour, no size, no script.

## `catalogue.json`

The platform's own ids, listed first in the picker and in the settings page. An entry points at
a lucide icon by name, or ships a drawing of its own:

```json
{ "id": "relay", "name": "Relay", "keywords": ["switch", "power", "contact"], "lucide": "plug-zap" }
{ "id": "boiler", "name": "Boiler", "keywords": ["heating"], "node": [ … ], "frame": { "x": 0, "y": 0, "size": 24 } }
```

- `id` follows the icon id pattern, `^[a-z0-9][a-z0-9-]{0,63}$`. It may be a lucide name -
  `printer`, `plug` and `lamp` are - and then the entry stands in for the lucide icon, with its
  own keywords and its place at the front of the list; every other lucide icon is loaded under
  its own name after the entries.
- `keywords` are what the search finds the icon by, beside its id and name. Lucide's own icons
  carry the keywords of lucide's `tags.json`.
- Re-pointing an id here - `light` from `lightbulb` to `lamp-ceiling` - changes every device
  that uses it, in every house, at the next start. An entry naming a lucide icon that does not
  exist fails the load, and so the service, at startup: a hole in the catalogue is a mistake in
  the repository, not something to serve.

Bundles name an entry as the icon their devices start with (`driver.json` → `defaultIcon`) and
as the icon each entity starts with (`profile.json` → an entity's `icon`); the interface's own
icons are lucide ids listed in `packages/ui/src/icons/ui-set.ts`, checked against this
catalogue by test. **A new icon is an id here or a row in `registry.icons`, never a
component** ([RULES.md §15.4](../../../RULES.md#154-icons)).

## `parseIconSvg`

Not an SVG renderer and not a sanitiser of one: a reader for the one dialect an icon needs,
that refuses everything else by name. It is pure and runs in the browser, so the editor shows
what the server will keep; the server reads the file again and trusts nothing it was sent.

| Kept                                                               | As                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`, `circle`, `rect`, `line`, `polyline`, `polygon`, `ellipse` | The shapes, with their own attributes (`d`, `cx`…, `points`) and `transform`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, `fill-rule`, `clip-rule`, `opacity`, `fill-opacity`, `stroke-opacity` |
| `g`                                                                | Folded into its children: its `transform` is composed onto theirs, its paint inherited                                                                                                                                       |
| `fill`, `stroke`                                                   | `none` stays `none`; any colour becomes `currentColor`                                                                                                                                                                       |
| A shape that says nothing about paint                              | Filled in `currentColor`, which is how a browser would draw it - black - rather than turned into an outline by the interface's stroke                                                                                        |
| `viewBox`                                                          | Returned beside the node, as a frame, so the editor can start from it                                                                                                                                                        |
| `title`, `desc`, `metadata`, `defs`, `style`                       | Skipped, subtree and all                                                                                                                                                                                                     |

| Refused                                                                                           | Because                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `script`, `image`, `use`, `foreignObject`, `text`, `a`, `svg` inside `svg`, and any other element | An icon is shapes; each of these is a way for a file to carry something that is not                                       |
| `href`, `xlink:href` and every `on*` attribute, on any element                                    | The same, at the attribute; any other attribute the table above does not name (`style`, `class`, `id`…) is simply dropped |
| More than 500 elements                                                                            | An icon that big is a picture; `api` also refuses a file over 64 KiB before reading it                                    |
| A file that does not start with an `<svg>` root, or draws no shape at all                         | It is not an icon file                                                                                                    |

A refusal is an `IconSvgError` whose message names what was wrong, in a sentence the owner can
act on; `api` turns it into a `VALIDATION` issue on `svg`.

`suggestIconId(name)` is the id the editor proposes for a new icon from its name - lower-case,
hyphenated, trimmed to the pattern - until the owner edits it.

## `IconCatalogue`

What `api` holds in memory: the built-in set with the owner's rows over it. A `custom` row is a
new id; an `override` row carries a built-in id and replaces its node, frame and keywords while
the name stays the built-in's. `has`, `isBuiltin`, `get`, `byIds` and `search(query, limit)` -
an exact id or name first, then a prefix, then a word inside, then a keyword, ties in catalogue
order with the platform's own entries before lucide's - are what the routes answer with. It is
rebuilt after every write, because one process is the only writer.
