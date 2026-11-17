# Dashboard cards, Add card, card settings, smaller screens

Build brief for the dashboard work designed on the redesign canvas, page **Dashboard · card e modifica**
(`https://claude.ai/artifact/4pCaH1weFogKWZ5JCZ2UNu`, version 314, 2026-11-17). It says what to build and
why each choice was made, so that whoever builds it does not have to guess from the pictures.

Read it with the boards open. Board names are in `code`. The generator of the boards is outside this
repository, in `D:\Projects\NebulaHome\design\dashboard-cards` (README there).

**Status of the choices.** Lines marked **(asked)** are what the owner asked for. Lines marked
**(proposed)** are the designer's choice, shown on the boards and not yet confirmed: build them as
written, but keep them easy to change. Section 10 lists them in one place.

---

## 1. What exists today

As read in the code on 2026-11-17. Check a path before relying on it.

| Thing          | Where                                                                                           | What it does                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Dashboard page | `apps/web-ui/src/routes/dashboard/dashboard-page.tsx`                                           | Read-only view, tabs per dashboard, "Edit layout" with `dashboard:manage`                                               |
| Editor page    | `routes/dashboard/dashboard-editor-page.tsx`                                                    | A separate route (`/configuration/dashboards/:id/edit`), not a toggle                                                   |
| Draft          | `routes/dashboard/dashboard-draft.ts`                                                           | zustand: `begin`, `change`, `select`, `end`; Done sends the whole layout with one PATCH                                 |
| Grid           | `routes/dashboard/dashboard-grid.tsx`, `dashboard/grid-engine.ts`, `dashboard/geometry.ts`      | Custom, 4 columns, rows of 100 px, 16 px gap, fluid column width                                                        |
| Sizes          | `dashboard/card-sizes.ts`                                                                       | `TILE` 1×1, `STRIP` 2×1, `CARD` 1×2, `SQUARE` 2×2, `LARGE` 2×3, `TALL` 2×4; `CARD_SIZES` per kind; `cardKindOf(entity)` |
| Card types     | `packages/contracts/src/api-dashboards.ts`                                                      | `entity`, `scene`, `clock`, `energy`, `package`, `container` (the group)                                                |
| Add card       | `routes/dashboard/add-card-dialog.tsx`                                                          | Kind grid, then the entity picker as a second modal; no size choice, no preview                                         |
| Card inspector | `routes/dashboard/card-inspector.tsx`                                                           | Fixed `aside` at the right, not draggable; entity, title, icon, size, "Place in", Remove                                |
| Narrow layout  | `dashboard-grid.tsx`, `narrowLayout` in `dashboard/dashboard-layout.ts`                         | Under 720 px of grid width: 2 columns, drawn only, never stored; editing is switched off                                |
| Package cards  | `packages/package-sdk` (`defineCard`, `CardProps`), `apps/web-ui/src/packages/package-slot.tsx` | Same React tree, error boundary, lazy chunk per card; manifest sizes `small`, `wide`, `medium`, `large`                 |

What does not exist: a preview of a card anywhere, a floating panel that is not tied to a package, a
one-column layout, a way to see narrower widths while editing, copy and paste of a card.

---

## 2. Sizes are called by their cells

Asked: no names for the sizes. The interface says **1×1, 2×1, 1×2, 2×2, 2×3, 2×4** (columns × rows)
everywhere: the size control, the Add card tiles, the messages. `sizeName()` already gives this, so
there is nothing to add. The words Tile, Strip, Card, Square, Large and Tall stay as the constants of
`card-sizes.ts` and never reach the screen. Package sizes map as today: `small` 1×1, `wide` 2×1,
`medium` 2×2, `large` 2×3. In the size control of the settings panel each choice also carries a small
drawing of its cells (section 8).

---

## 3. One rule when the entity can do less — board `K-Capabilities`

> A control the entity lacks is not drawn. What is left moves up. A size with nothing left to show is
> not offered.

No disabled controls, no placeholders for a missing capability: the card simply has fewer parts.

| Kind                | When it lacks…     | The card…                                                                                                    | Sizes offered    |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| Light               | brightness         | is drawn as a switch (1×1: toggle and On/Off; 1×2: the round power button and the day's bars)                | 1×1, 1×2. No 2×2 |
| Light               | white and colour   | has brightness only: no swatches, no second slider                                                           | 1×1, 1×2, 2×2    |
| Light               | colour only        | keeps brightness and the white slider, no swatches                                                           | all              |
| Cover               | position           | shows the state in words in place of the percentage; no window drawing; 1×2 has three wide buttons           | 1×1, 1×2         |
| Cover               | stop               | has two buttons                                                                                              | all              |
| Cover               | tilt               | has no tilt line                                                                                             | all              |
| Thermostat          | more than one mode | has no mode switch                                                                                           | all              |
| Thermostat          | a settable target  | only reads: target and mode as two rows of text                                                              | 1×2, 2×2         |
| Thermostat          | humidity           | drops the humidity reading                                                                                   | all              |
| Media player        | cover art          | shows a plain tile with the note icon                                                                        | all              |
| Media player        | seek / position    | has no progress bar and no times                                                                             | all              |
| Media player        | previous, next     | draws only the buttons the player has                                                                        | all              |
| Media player        | anything playing   | says "Nothing playing" and the last title; Play stays, the others are off                                    | all              |
| Lock, vacuum, mower | battery            | drops the reading; nothing takes its place                                                                   | all              |
| Vacuum              | rooms              | 2×2 shows the last clean (finished, time, area) and one Start                                                | all              |
| Vacuum              | locate             | has no Locate button                                                                                         | all              |
| Camera              | a live stream      | says SNAPSHOT in place of LIVE, shows the time of the picture, and Refresh in place of Snapshot              | 2×2, 2×3         |
| Camera              | recording          | 2×3 keeps the picture whole and drops the events row and Record                                              | 2×2, 2×3         |
| Sensor              | history            | keeps its size; the chart area says "The chart starts with the next readings"; min, average, max show a dash | all              |

How to build it: `cardKindOf` already picks the kind from capabilities. Add, per kind, a function
`allowedSizes(entity)` that filters `CARD_SIZES[kind].sizes`, and use it everywhere `sizesOf` is used
today. Each card component reads the entity's capabilities and renders its parts conditionally. Do
not add a second component per variant.

The size control of the settings panel (section 8) offers only the sizes this entity can fill and
names what is missing in one line under it ("No 2×2: this light has no brightness"). Keep a small map
`kind → size → reason` beside `CARD_SIZES` for that line; the section "Sizes on offer" of the board
shows the same rule. A card stored at a size it can no longer fill is drawn at the
largest size that fits (`snapSize` does this today at render time; keep it draw-only).

---

## 4. Six states every card shares — board `K-States`

The same six for every kind. Build them once in the shared card frame (`cards/card-parts.tsx`), not in
each card.

| State           | When                                     | What the card does                                                                                                                                      |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not reachable   | the entity is unavailable                | Icon chip grey, an "Offline" pill in the header, the last value dimmed, "last seen 13:20". Controls are drawn but disabled, so the card keeps its shape |
| No value yet    | the entity exists and has never reported | A dash, never a zero or an "Off". Controls work                                                                                                         |
| Disabled entity | switched off in Devices                  | Dashed edge like a removed entity. "Enable" only for who may manage devices; others read "Ask an admin"                                                 |
| View only       | the role lacks `entity:control` for it   | No toggle, slider or button is drawn. The value stays. A small eye in the header corner                                                                 |
| Sending         | a command went out and is not confirmed  | The control shows it at once (knob moved with a spinner, "Turning on…"). Other controls of that card are off until the answer                           |
| No answer       | no confirmation in time                  | The control goes back, the card says "Did not answer" in the danger colour with "Try again". The message leaves by itself                               |

**(proposed)** "in time" is 10 seconds and the message leaves after one minute. Both are sample
numbers: take them from one constant.

A removed entity keeps the existing `MissingCard` (board `K-All`, section "Missing entity").

---

## 5. New kinds — board `K-New`

Fan, Time, Date and Person are entity cards: add them to `ENTITY_CARD_KINDS`, `CARD_SIZES` and
`cardKindOf`. The others are new card types in the layout schema. Adding a type to the union keeps old
layouts valid, so `DASHBOARD_LAYOUT_VERSION` does not change. The field names below are a suggestion.

| Card        | Sizes         | Stored as                           | Notes                                                                                                                                                                                                         |
| ----------- | ------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fan         | 1×1, 1×2, 2×2 | `entity`                            | On/off, speed in percent or in steps, presets, swing, direction. Section 3's rule applies: a fan with on/off only is a switch-like 1×1                                                                        |
| Time · Date | 1×1, 2×1      | `entity`                            | 1×1 reads the value and how far away it is. With the `set` feature the 2×1 edits in place: the change is a draft and one "Set" sends the whole value (same rule as the entity sheet boards `N-Entity-Time-*`) |
| Person      | 1×1, 1×2, 2×2 | `entity`                            | Home, Away or the zone's name. The map shows in 2×2 only                                                                                                                                                      |
| Bars        | 2×1, 1×2, 2×2 | `entity` with `chart: 'bars'`       | For totals and prices: one bar per hour or day, the current one marked. For prices, low hours in the success colour and dear ones in the warning colour                                                       |
| Compare     | 2×2, 2×3      | new `compare` `{ entityIds[] }`     | Up to four sensors with the same unit. Each keeps the colour of its row                                                                                                                                       |
| Activity    | 1×2, 2×3      | new `activity` `{ scope }`          | Newest first, from `history.state_history`. Scope is the house, one area or picked entities. Read only                                                                                                        |
| Automation  | 1×1, 2×1      | new `automation` `{ automationId }` | Toggle, Run now, last run, next run when it has a time. A failed run stays red until the next good one                                                                                                        |
| Note        | 1×1, 1×2      | new `note` `{ title, text, icon }`  | Text only, no entity. Editable by whoever may edit the dashboard                                                                                                                                              |
| Shortcut    | 1×1           | new `shortcut` `{ target }`         | A page, a package or a web address. An address outside the hub opens in a new tab and shows the outward arrow                                                                                                 |

Not here on purpose: Weather, Energy and Cameras bring their own cards with their package (Energy also
has its built-in `energy` type). A Heading card was dropped because it would not fit the 100 px rows;
a Group already gives a title.

---

## 6. Cards that gather entities — boards `K-Aggregate`, `K-Overview`

### 6.1 Together (lights, switches, covers, locks, thermostats)

One card that stands for many entities of the same kind. It is not a Group: a Group frames separate
cards; this is a single card with a single state.

Suggested shape: a new card type `together` with `domain` and `members`:

```ts
members:
  | { mode: 'rule'; areaId: string | null; exclude: string[] }   // null = the whole house
  | { mode: 'hand'; entityIds: string[] }
```

- **(proposed)** By rule is the default. The rule is resolved in the browser from the entity list each
  time the card draws, so a new light in the Kitchen joins by itself and a removed one leaves. By hand
  the list never changes alone; a removed member is dropped silently and the count goes down.
- The card counts ("4 of 6 on"), shows the average of the main value, and acts on all members at once.
- **(proposed)** Members that differ: a control stays if at least one member can use it, and its label
  says how many ("Brightness · 3 of 4"). The command goes only to the members that support it. If no
  member can dim, the card falls back exactly like a single on/off light (section 3).
- Members that do not answer are left out of the count and named apart ("3 of 5 on · 1 offline").
- 2×3 lists the members, each with its own value and its own small switch. 2×2 for switches and
  locks lists them beside the count; a sixth row turns into "and 2 more".

Per kind:

| Kind        | Reads                                                                                     | Acts                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lights      | how many are on, average brightness                                                       | the switch turns all on or off; brightness and white go to every member that has them                                                                       |
| Switches    | how many are on                                                                           | the switch turns all on or off                                                                                                                              |
| Covers      | the average position; "from 20 to 100%" when they differ; "3 of 5 open" without positions | Open, Stop, Close and the position slider go to all                                                                                                         |
| Locks       | "All locked" only when every lock is                                                      | **(proposed)** "Lock all" only. Unlocking is never offered for the group: it stays on each lock with its hold                                               |
| Thermostats | average and spread, how many are heating                                                  | **(proposed)** the target stepper moves every thermostat by the same step, so rooms keep their differences. When targets differ the stepper shows the range |

Send the commands one per member through the existing command path. Show "Sending" (section 4) until
every member answered; if some did not, say how many ("2 did not answer") with Try again for those only.

### 6.2 Summary

Counts what needs a look, across the house or one area: doors and windows open, lights on, batteries
low, updates ready, entities not reachable. Suggested type `summary` `{ what, areaId }`.

- Coloured only when the count is above zero; quiet (grey icon, success dot, "All closed") otherwise.
- One action at most: "All off" for lights, "Review" for updates. No action for the others.
- Tap opens the list of what was counted. The 1×2 shows the first three inline.
- The 2×1 is "the house at a glance": the five counts side by side.

### 6.3 Room

One area in one card. Suggested type `room` `{ areaId }`. Climate on top (the area's temperature and
humidity sensors, and the thermostat's action as a badge), then one row per group the area has: Lights,
Blinds, Speaker, Heating. Each row is a small Together card: it reads the count and has the one control
that matters. A row the area has nothing for is not drawn. Without a thermometer the 1×1 says what is
on.

### 6.4 Entity list and Quick actions

- **Entity list** (`list` `{ entityIds[] }`): entities of any kind as rows, each with its value or its
  one main control. 1×2 holds four rows, 2×3 six. Tap a row for the entity sheet.
- **Quick actions** (`actions` `{ items[] }`, an item is a scene, a button entity or a switch): plain
  buttons with no readings. Two in a 1×1, four in a 2×1, six in a 1×2. A switch stays lit while on.

---

## 7. The editor and Add a card — boards `N-Dashboard-Edit`, `N-Dashboard-Add*`

Asked:

- Add card and Add group leave the top right. Adding starts on the grid: an empty space under the
  pointer offers Add card, or Paste when a card was copied.
- The editing bar at the top weighed too much.
- In the Add card dialog the previews stay; there is no screen for the size. The card is added at a
  fixed size, the smallest, and everything else is done from the settings panel (section 8).

### 7.1 The editing header — board `N-Dashboard-Edit`

It replaces the boxed bar with the accent edge. A plain row, 36 px high, where the page header is in
the read-only view: no border, no fill.

- Left: a small "Editing" tag (mono, accent outline), the dashboard's name, and one muted line:
  "Everyone who uses it sees the change".
- Right: the Desktop · Tablet · Phone switch (section 9), Cancel (ghost), Done (primary). Nothing else.
- It stays at the top while the page scrolls, on the page background, because it holds Done.

### 7.2 Cards while editing

| The card          | Looks like                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| At rest           | Full strength, a dashed outline, nothing on top of it                                          |
| Under the pointer | A solid outline and three handles: the grip, Remove and the resize corner                      |
| Selected          | The accent ring and the same handles in the accent colour. The other cards go to half strength |

- The grip sits on the middle of the top edge and Remove on the top right corner, both half outside
  the card, in the gap between cards, so they never cover its content. The resize corner is inside,
  bottom right.
- Today every card carries a size chip, a grip, a Remove button and a corner all the time, over its
  content. They go: the size is in the panel, and the handles come with the pointer.
- Keyboard focus counts as the pointer. On a touch screen a tap selects, so the handles are there.
- While a corner is dragged, the size it will take is written beside the pointer ("2×2").
- Moving and swapping by drag stay as they are today. They are not redrawn on the new board.

### 7.3 Empty spaces: Add card and Paste — boards `N-Dashboard-Edit`, `N-Dashboard-Card-Settings-Copy`

- The editor draws every free cell as a dashed space, and always one whole empty row under the last
  card. Groups do the same inside their frame.
- Under the pointer a space takes the accent dashed edge and shows **Add card**. When a card was
  copied (section 8) it shows **Paste "name"** first and Add card second.
- Add card opens the dialog (7.4) and the card chosen lands **in that space**. Paste puts the copy
  there, with its size and its settings, and selects it.
- A card larger than the room around the space is placed with its top left cell on the space and the
  cards in the way move down, as when a card is dropped there (`grid-engine.ts`).
- A space is a real button: it takes focus, Enter is Add card, Ctrl/Cmd+V pastes into it. On a touch
  screen a tap shows the same buttons.
- In the tablet and phone preview (section 9) the spaces are not drawn.

### 7.4 The dialog: what to add

`N-Dashboard-Add`, `N-Dashboard-Add-Other`, `N-Dashboard-Add-Packages`, `N-Dashboard-Add-Search`

One dialog, **one step**. It replaces `add-card-dialog.tsx` and the second modal of the entity picker.

- Left: categories with counts (All cards, For one entity, Together, Summing up, From packages, Other).
  "From packages" shows only when an installed package offers cards, as today.
- Right: one tile per card kind. Each tile holds a **live preview**, the name, one line of what it is
  and the sizes it comes in, as cells ("1×1 · 1×2 · 2×2"). The whole tile is the button; under the
  pointer it gets the accent ring and "+ Add".
- **The group is a card kind**, under Other: it is the `container` type the layout already has. It is
  added like any card, takes the full width from the row of the space, and its own empty spaces take
  cards. It is not offered when the space clicked is inside a group.
- The search field has the focus when the dialog opens; it shows no shortcut key. It looks in three
  places at once: entities (name, area, address), areas, card kinds. An entity row carries one button,
  the card that entity gets (`cardKindOf`). An area row carries three: Room, Lights together, Summary.
  Each button adds that card with the entity or the area already set.
- A package tile carries the package's name. Under the last package tile, a dashed row links to the
  Packages page.

### 7.5 What a click does

One click on a tile or on a row button:

1. adds the card to the draft in the space that was clicked (7.3), at **the smallest size on offer**:
   `allowedSizes(entity)[0]`, or the first size of the kind when there is no entity yet;
2. closes the dialog;
3. selects the card and opens the settings panel on it.

The dialog always closes after one card. Several cards are several spaces, or Copy and Paste.

What the panel opens with depends on what the card still needs:

| Added from                    | The card                         | The panel opens with                          |
| ----------------------------- | -------------------------------- | --------------------------------------------- |
| A search row of an entity     | complete, live                   | its fields; Size is the next thing to look at |
| A kind tile of an entity card | dashed, "No entity yet"          | the Entity field open: search and the list    |
| Together, Summary             | complete: rule "the whole house" | Members / Where                               |
| Room                          | dashed, "No room yet"            | Where open                                    |
| Group, Clock, Note, Shortcut  | complete or empty by nature      | its fields                                    |
| A package card                | drawn with the manifest defaults | the framed block "Asked by the package"       |

- The Entity list shows only the entities that kind of card takes. Entities already on this page are
  dimmed and say "on this page"; they can still be chosen.
- **(proposed)** A card still without its entity (or its room) stays dashed while editing and is left
  out when Done saves; the toast says how many were left out. Nothing half-made reaches the stored
  layout.

### 7.6 How a preview is drawn (asked: not pictures)

A preview is the real card component, not an image, so it can never drift from the card and package
cards work the same way.

Build one component, `CardPreview`:

```tsx
<CardPreview card={sampleCard} size={TILE} scaleToFit={{ w: 236, h: 104 }} />
```

- It renders the same component `card-view.tsx` renders, inside a box of fixed pixels:
  `w × 267 + (w − 1) × 16` wide and `h × 100 + (h − 1) × 16` high (267 px is the column the cards are
  designed at; keep it as one constant).
- The box is `inert` and has `pointer-events: none`: a preview never sends a command.
- The card gets a fixed sample entity for its kind from a fixtures file, with no request to the
  server. One fixture per kind, the ones drawn on `K-All`.
- `scaleToFit` shrinks with a CSS transform to fit the tile. Never enlarge.

There is no live preview in the dialog: once added, the card on the page is the preview.

**Package cards.** The preview goes through the existing `PackageSlot` (same loader, same error
boundary), with one addition to the public SDK:

- `CardProps` gains `isPreview: boolean`. When true the card must draw itself with sample values, must
  not open streams or subscriptions, and must not send commands. Document it in `PACKAGES_DOCS.md` §6
  and bump `@nebulahome/package-sdk` by a minor.
- The manifest card gains an optional `preview: { options }`: the option values to use for the sample.
- A package whose SDK is older than this, whose chunk fails to load, or that is not running gets the
  neutral tile: the package icon, "No preview from this package", name and sizes. Adding still works.
- Load package previews lazily, when their tile scrolls into view: each one is a dynamic import.

### 7.7 Shell

Same shell as the install sheets (`N-Integrations-Install`): 1120 px wide, 860 px high at most, the
glow at the top, the 42 px search, the foot. Reuse the component the install sheet uses; do not add a
new modal size if that one already exists. The foot holds one line of help and the count of cards,
no buttons.

---

## 8. Card settings: a floating panel in a fixed place — boards `N-Dashboard-Card-Settings*`

Asked: floating, so the card can be watched while it is edited, but **in one fixed place, the top
right**, not beside the card. It replaces the fixed `aside` of `card-inspector.tsx`.

- **Opening**: in the editor, a click on a card (not a drag) selects it and opens the panel. A card
  just added opens it by itself (7.5).
- **Where**: top right of the page, 12 px under the editing header, its right edge on the header's
  right edge. `position: fixed`: it does not move when the page scrolls and it does not follow the
  card. It is not dragged: no grip, no drag code.
- **(proposed)** **When the selected card is under it** (their rectangles overlap), the panel takes
  the mirrored place, top left, so the card stays in sight. It goes back to the right with the next
  card that is not under it. Board `N-Dashboard-Card-Settings-Left`.
- **Floating**: it lies over the grid with its shadow and takes no room from it, so the cards keep
  their real width while they are edited. Its height follows its fields, up to the window minus 24 px;
  beyond that the fields scroll between the header and the foot.
- **No scrim, not modal**: the dashboard under it stays live and can be scrolled; clicking another card
  switches the panel to that card; Escape or the close button closes it and gives focus back to the card.
- **Live**: every field writes to the draft (`draft.change`), so the card redraws at once. Nothing is
  saved until Done; Cancel discards. Asked: no line in the panel says so. The panel is the header
  (icon, name, kind of card, close), the fields and the foot, with nothing between them.
- **Width** 320 px. Under 640 px of window width it becomes a bottom sheet of half the height, with
  the selected card scrolled into view above it (not drawn on a board).
- Do not reuse the package `Floating` window: it is tied to a package and has throw physics.

Fields, top to bottom. Size comes right after what the card is about, because the panel is the only
place where the size is chosen:

| Card                                      | Fields                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Entity card (`N-Dashboard-Card-Settings`) | Entity · Size · Name and icon (the platform's icon button and popover) · Show · When tapped           |
| New entity card (`…-New`)                 | Entity, open · Size. The other fields come once the entity is chosen                                  |
| Together (`…-Together`)                   | Members (By rule / By hand) · Where · Leave out · "6 lights match now" · Size · Name and icon         |
| Package card (`…-Package`)                | A framed block "Asked by the package" with the manifest `options` drawn by `SetupForm` · Size · Title |
| Others                                    | What the inspector has today, plus Size                                                               |

**Size** is a segmented control with the sizes on offer only. Each choice is its cells, drawn as small
blocks and written ("1×2"); there is no name. When the kind has a size this entity cannot fill, one
quiet line under the control says so ("No 2×2: this light has no brightness"), from the
`kind → size → reason` map of section 3. Changing the size resizes the card in place; when the new
size does not fit where the card is, the grid makes room as it does for a resize by the corner.

**(proposed)** two new options, stored on the card:

- **Show**: switches for the parts a size can do without ("Colour presets", "Brightness slider",
  chart, trend…). Each card kind declares the list for each size. Store the hidden ones:
  `hide?: string[]`.
- **When tapped**: "Open the light" (the entity sheet, default), "Turn on or off", "Nothing". Only the
  choices the entity supports. Store `tap?: 'sheet' | 'toggle' | 'none'`.

### 8.1 The foot: Remove and Copy — board `N-Dashboard-Card-Settings-Copy`

Asked: Copy takes the place of Duplicate, and "Place in" goes: copy and paste do its job.

- **Remove** (danger) on the left, **Copy** on the right.
- Copy keeps the card (its type, entity, size and options) in the editor's clipboard. The button reads
  "Copied" while that card is the one kept. One card at a time: a new Copy replaces it.
- Paste is on the empty spaces (7.3), on the page and inside a group. The copy gets a new id.
- **(proposed)** The clipboard is the editor's own, not the system's, and lives in `sessionStorage`,
  so a card can be pasted into another dashboard's editor in the same tab.
- **(proposed)** Keys on the selected card: Ctrl/Cmd+C copies, Ctrl/Cmd+X copies and removes,
  Ctrl/Cmd+V pastes into the space with the focus or under the pointer, else in the first free spot
  (`firstFit`).
- **Moving a card into a group, or out of it**, was "Place in". Now it is copy, paste in a space of
  the group, remove the first one, or Ctrl/Cmd+X then Ctrl/Cmd+V. The code that moves a card between
  the page and a `container` is the one "Place in" has today: Paste into a group's space reuses it.

---

## 9. Smaller screens while editing — boards `N-Dashboard-Edit-Tablet`, `N-Dashboard-Edit-Phone`

Asked: see how the dashboard behaves on smaller screens while editing it.

- The editing header (7.1) has a three-way switch: **Desktop · Tablet · Phone**.
- Tablet and Phone put the grid inside a frame of that width (768 and 390 px), centred on the dotted
  floor, with the width and the number of columns written above it. The two edges of the frame can be
  dragged for any width; the label follows.
- It is a preview: cards cannot be moved or resized there, the empty spaces are not drawn, and the
  hint says so. Card settings still open, so a size can be changed while looking at the phone.
- The frame is the window of that device: inside it the page keeps its gutter (24 px at tablet, 16 px
  at phone). The navigation is not drawn.

How to build it: wrap the grid in a box of the chosen width. The grid already measures its own width
with a `ResizeObserver` and draws `narrowLayout` when narrow, so the preview is the real thing, not a
copy. In preview, skip the "Widen the window…" message and keep editing locked instead.

**(proposed)** the column rule changes, because today's gives columns of about 170 px at tablet and at
phone width, too narrow for a card designed at 267 px:

| Grid width      | Today     | Proposed     |
| --------------- | --------- | ------------ |
| 900 px and more | 4 columns | 4 columns    |
| 720 to 899 px   | 4 columns | 2 columns    |
| 480 to 719 px   | 2 columns | 2 columns    |
| under 480 px    | 2 columns | **1 column** |

So no column is narrower than about 210 px. This is `NARROW_WIDTH_PX` becoming two thresholds and
`narrowLayout(layout, columns, sizesOf)` accepting 1.

Rule for one column, stated once: a card keeps its height; a two-column size takes the one-column size
of the same height when its kind has one (2×1 to 1×1, 2×2 to 1×2); a kind with no one-column
size (media player, camera, energy, package cards) keeps its size and is drawn in the single column,
so those cards must hold at 320 px. The phone board shows the media 2×2 laid out for that width.
Groups take the full width and reflow their own cards the same way.

The stored layout stays one, for four columns. There is no layout per breakpoint and nothing is
written when previewing.

---

## 10. Open choices

Confirm with the owner before, or build so they are one constant away:

1. Members by rule as the default (6.1).
2. A control stays when at least one member supports it, with "3 of 4" (6.1).
3. Locks together offer only "Lock all" (6.1).
4. Thermostats together move every target by the same step (6.1).
5. "No answer" after 10 s, message gone after a minute (4).
6. Copy and paste: the clipboard in `sessionStorage`, the keys Ctrl/Cmd+C, X, V (8.1).
7. The new card options Show and When tapped (8).
8. Columns: 4 from 900 px, 2 from 480 px, 1 below (9).
9. The field names of the new card types (5, 6).
10. A card with no entity yet is left out when Done saves (7.5).
11. The settings panel goes to the top left when the selected card is under it (8).
12. The group is added from the Add card dialog, as a card kind under Other (7.4).
13. Cards at full strength while editing, with their handles only under the pointer (7.2).

Not designed: the light theme, the settings bottom sheet on a phone, the settings of a group, the
drag to move and swap (unchanged), the list a Summary opens, the full-screen map of a Person.

---

## 11. Order to build in

Each step can ship alone.

1. `allowedSizes` with the capability rule on the existing cards (3).
2. The six shared states in the card frame (4).
3. The editor: the header, the handles under the pointer, the empty spaces with Add card (7.1 to
   7.3). Then the settings panel, floating and fixed at the top right, with today's fields, Copy and
   Paste (8), then Show and When tapped.
4. `CardPreview` and the one-step Add card dialog for the existing kinds (7); it needs step 3,
   because the size is chosen in the panel. Then `isPreview` in the SDK for package cards.
5. The width switch and the column rule (9).
6. The new entity kinds: Fan, Time · Date, Person, Bars (5).
7. Together, then Summary and Room, which reuse it (6).
8. Compare, Activity, Automation, Note, Shortcut, Entity list, Quick actions (5, 6.4).

Contracts first for every step that adds a card type: `packages/contracts/src/api-dashboards.ts`, then
rebuild contracts before the web-ui sees the new export.
