# The vendor directory, file by file

What every file of an integration's `src/` says, in full: the grammar the hub's loader holds a
vendor to, with the reasons behind its limits. `README.md` is the short version and the commands;
`schemas/*.schema.json` are the same rules for an editor. Examples come from the vendors written
with the platform - Shelly, Bambu Lab, Sonoff, Zigbee2MQTT, ECOVACS, SolaX Power - each now in
its repository `integration-<vendor>`.

Loaded means present and offering to connect to devices; nothing is connected until somebody
adds one. Adding one is the whole of it: a device added from the vendor's page is an instance of its
driver and a row in the registry under one id, and the hub identifies the hardware behind it
by itself. A vendor with a `discovery.json` is also **found**: the hub listens for its devices
announcing themselves and the integrations page offers each one it hears to adopt - which is
adding it, with the driver, the model and the address already filled in. Nothing is added
until the owner says so.

A bundle is a **vendor directory** - an integration repository's `src/` - holding one **driver
directory** per profile or entry point:

```
src/                    the vendor shelly
├── manifest.json       who the vendor is                            ← always
├── logo.svg            the mark the interface shows (.svg or .png)  ← optional
├── setup.json          what every device of the vendor shares       ← optional
├── discovery.json      how its devices are found unasked            ← optional
├── rpc/transport.ts    a transport of the vendor's own              ← optional
└── dimmer-pm/
    ├── driver.json     transport, models, which file holds it       ← always
    ├── setup.json      what adding one device asks                  ← always
    └── profile.json    the declarative mapping (or index.ts, code)  ← one of the two
```

The repository's `README.md` says what the devices are and what is unverified; it stays out of
`src/`, which the build packs whole.

The directory names are the ids: `shelly` must say `"id": "shelly"` in its manifest and
`dimmer-pm` must say `"id": "dimmer-pm"` in its driver file, or the loader refuses the directory
and says which two names disagree. Together they make the driver's **kind**, `shelly/dimmer-pm`,
which is what a device row references.

`manifest.json` says who the vendor is. Which transports a vendor speaks is derived from its
drivers, so it cannot be declared wrongly; what the manifest may add is a transport the vendor
**ships** - see below:

```json
{
  "id": "shelly",
  "name": "Shelly",
  "description": "Shelly devices of every generation on your own network: Gen2, Gen3 and Gen4 spoken to over their RPC interface, Gen1 over its HTTP API and the CoIoT packets it sends on every change.",
  "url": "https://shelly.com",
  "color": "#3B9DFF",
  "logo": { "path": "./logo.svg", "padding": 4 },
  "internetRequired": false,
  "transports": {
    "rpc": { "module": "./rpc/transport.js", "wires": ["http"] },
    "gen1": { "module": "./gen1/transport.js", "wires": ["http"] }
  }
}
```

`logo` is a path relative to the bundle, either bare - `"logo": "./logo.svg"` - or, as above,
with `padding` (0 to 16, default 0): extra room, in pixels, the interface leaves around the logo
inside its tile. Every logo already gets a small margin; this is on top of it, for a mark drawn
to the very edge of its file. It cannot ask for less than the margin, only for more.

`requires` says what the vendor's devices need besides the hub, in the grammar a
package's manifest uses (PACKAGES.md §8, Dependencies):
`{ "services": ["mqtt-broker"] }` for Zigbee2MQTT, which talks through the house's broker, or a
package by id and range. Until what it needs runs, the vendor waits: its instances fail with the
sentence that names the package, `api` refuses its devices with `409 needs-package`, and its page
says so first. The hub follows the packages at every `pkg.*` event and starts only that vendor's
instances again when its standing changes. A container that speaks to the broker names its topics
in `mqttTopics`, and is given a username of its own held to them.

`driver.json` says how one profile is loaded and **which models it drives**. The list is what the
owner picks from when adding a device: Bambu Lab's `printer-p1-a1` driver lists five printers, so
the form offers five choices and the row remembers the one picked, though all five run the same
profile. A driver that lists no model offers its own name. Strict, and without the vendor's
fields on purpose - a driver repeating the vendor's name would be a second copy to keep in step:

```json
{
  "id": "dimmer-pm",
  "name": "Dimmer with power metering",
  "transport": "shelly/rpc",
  "models": ["Dimmer 0/1-10V PM Gen3", "Dimmer 0/1-10V PM Gen4", "Dimmer Gen3", "Dimmer Gen4"],
  "modelCodes": {
    "S3DM-0010WW": "Dimmer 0/1-10V PM Gen3",
    "S4DM-0010WW": "Dimmer 0/1-10V PM Gen4",
    "S3DM-0A101WWL": "Dimmer Gen3",
    "S4DM-0A101WWL": "Dimmer Gen4"
  },
  "defaultIcon": "light",
  "webPagePort": 80,
  "kind": "declarative",
  "profile": "./profile.json",
  "setup": "./setup.json"
}
```

`webPagePort` says the device serves a web page of its own, and on which port: a device of a
driver that names one gets a **Web page** link in the header of its page, to
`http://<host>:<port><webPagePath>`. `webPagePath` is optional and starts with `/` - Plex Web is at
`/web`. When the address the owner typed carries a port, that port wins: the device answers the
platform and the browser from the same server. A driver whose devices have no page to look at -
an API port answering JSON, a UDP protocol - names no port and gets no link.

`modelCodes` maps what the hardware calls itself onto the model on the box, and it is how
discovery knows which driver a device it heard belongs to and which model to adopt it as. A code
may name a list when the hardware says its family but not which of it it is - a Sonoff in DIY mode
announces `diy_plug` whether it is a BASICR3 or a MINI - and the owner then picks among those.
Every model named must be in `models`, and a driver that lists none maps no codes.

`modelSeries` puts each model in the series the vendor sells it as, for a vendor whose
drivers follow what the hardware needs rather than how the owner knows it: Bambu Lab's X1C and
X2D are both `"X series"`, run by two drivers because their entities differ. The form then groups
the vendor's models by series, across its drivers - the series by name, the models in each in
counting order - and a device's page says its series where it would say the driver's name. A
model given no series is grouped under its driver. Every model named must be in `models`.

`transport` is a platform transport - `http`, `mqtt`, `matter` - or one the driver's own vendor
ships, named after the vendor: `shelly/rpc`. Never another vendor's: vendors load in no particular
order, and a driver leaning on another's transport would load or not by luck.

A driver of the vendor's **Matter devices** is `"transport": "matter"` with `"kind": "matter"` and
neither a profile nor an entry: the platform's own Matter mapping runs it - lights, switches,
covers, locks, thermostats, the usual sensors, power and energy, the firmware - so the vendor's
Matter devices are its own, on its page, without code. Which devices those are its
`discovery.json` says (below), and `modelCodes` maps what they call their model - their product id,
unless the vendor says another field - onto the models it lists.

`defaultIcon` names the icon a device of this driver starts with, by its id in the platform's
icon catalogue (`packages/icons/catalogue.json` lists the platform's own ids - `light`,
`relay`, `printer`, `sensor`… - and every lucide icon is there under its own name). The owner
may pick another per device. The hub does not check the id; the API does when a device is
added, and falls back to no icon with a warning rather than refusing the device, so a typo in
somebody's bundle costs a blank tile and not the device.

Each entity in `profile.json` may name its own `icon` the same way - `"icon": "thermometer"` on
a temperature sensor - and it is the bundle's first word only: the owner may rename an entity
or pick another icon from the devices page, and identifying the hardware again does not put the
bundle's back. An entity that names none shows a blank tile until the owner picks one.

The format is `packages/package-runtime` and the ceiling it enforces is deliberate: every object
is strict and every expression is a path, so a profile cannot become a program one feature at a
time. A device whose entities are not known in advance needs a code driver instead. Two forms go
as far as the ceiling allows, and no further: a claim may ask that a path be **one of** a list of
values - `{ "path": "model", "oneOf": ["S3DM-0010WW", "S4DM-0010WW"] }`, which is how one driver
serves a family of models - and a state may be **looked up in a table** -
`{ "path": "'cover:0'.state", "map": { "opening": "opening" }, "default": "stopped" }`, which
renames what a device says into what a capability accepts. A list is membership, not an `or`
between paths; a table renames and cannot compute.

A condition, in a claim or a `discovery.json`, may also ask that a text **start** or **end** with
something (`startsWith`, `endsWith`, without regard to case - a MAC address's maker is its first
three bytes), that a text or a list **contain** something (`contains`: a part of a text, without
regard to case, or one item of a list - `{ "path": "deviceTypes", "contains": 266 }`), or that a
number lie **in a range** (`{ "path": "softwareVersion", "min": 10 }`, both ends included). There
is no regular expression, on purpose: one written badly holds the hub's thread for as long as it
backtracks, and the grammar is what keeps a bundle of data from doing that.

A third form reads whether something is **there** -
`{ "path": "sys.available_updates.stable", "present": true }` - true when the path names a value,
false when the object that would hold it is there without it. It is the one read that turns an
absence into an answer, and only where the report carries the holder: a report without `sys` at
all still says nothing.

A fourth reads **part of a number** - `{ "path": "device.bed.info.temp", "bits": [16, 16] }`, the
bits from the 16th, 16 of them - for firmware that packs two readings into one integer or a set
of flags into one word, and may be compared or looked up like any value:
`{ "path": "stat", "bits": [23, 1], "base": 16, "equals": 1 }` is a door, read out of a flags word
the printer writes as hexadecimal text. `base` alone reads a number written as text -
`{ "path": "humidity_raw", "base": 10 }` - and text that is no number yields nothing. It is
indexing into a number, as a path indexes into a list, and nothing more.

Finally a field may name **up to four places**, tried in order, the first that yields a value
being the one read - `[{ "path": "device.bed.info.temp", "bits": [0, 16] }, "bed_temper"]` -
for firmware that moved a reading and still sends it in either place.

An entity with the **`button`** capability (domain `button`) holds no state: it is reported, empty,
on anything its device says, so it is available exactly when the device is, and its one command is
`button.press`. A profile gives it `"state": {}` and the request pressing it sends. With
`"deviceClass": "restart"` the interface asks before pressing, since the device goes away for a
while.

An entity may report **attributes** beside its state: `"attributes": { "endsAt":
"pairing.endsAt" }`, each a camelCase key read the way a state field is, into a scalar. They are
for what a page needs of the entity and the entity itself is not - the Zigbee2MQTT bridge's
_Pairing_ sensor says `enabled` and carries when pairing closes as `endsAt`, which the vendor's
page counts down. Every report carries all of them, and one whose source names nothing is left
out, so an attribute that stopped being said is gone rather than stale.

A command's request carries values out of the command as **references** -
`{ "$": "command.level" }`. A device that counts in other units says so: `scale`
multiplies a number, `decimals` rounds it, `min` and `max` clamp it, in that order, and
`"optional": true` leaves the key out of the request when the command does not carry the value,
instead of sending `null`. That is how a fade reaches a Shelly dimmer, which takes seconds:
`"transition_duration": { "$": "command.transitionMs", "scale": 0.001, "decimals": 1,
"optional": true }`. A reference is still a path and nothing more; anything it does not name is a
literal.

A light that can **fade** says so on each capability that can: `"on_off": { "hasTransition":
true }`, and the same on `level`, `color_hs` and `color_temp`. The
platform drops `transitionMs` from a command to a capability that does not say so, and the editor
offers no Transition field for it, so a lamp that changes at once is never promised a fade. A
device added before its driver said so keeps what it was added with until it is added again.

### Firmware updates

A driver whose devices say which firmware they run and what is on offer exposes one entity of domain
`update` with the `update` capability: `installedVersion`, `latestVersion` (absent - null - when
nothing newer is offered), `isInstalling` and, for a device that says, `progress`; its one command
is `update.install`. `canInstall: false` in its params says the platform cannot install it, only
tell. The hub refuses an install while the entity reads `isInstalling`, for every vendor: a device
fetching its firmware still offers it until it reboots, and an automation installing whatever is
offered must not start it again.

The Shelly drivers read `device_info.ver` (the transport asks `Shelly.GetDeviceInfo` on every
connection and lays it beside the status), `sys.available_updates.stable.version`, and
`ota.isInstalling` / `ota.progress`, which the transport keeps from the device's `NotifyEvent`s
(`ota_begin`, `ota_progress`, `ota_success`, `ota_error`) and from the moment `Shelly.Update` was
accepted, until the device is back on another version; a second `Shelly.Update` meanwhile is not
sent. The Gen1 drivers read `update.old_version`, `update.new_version` and `update.status`
(`updating`) and install through `/ota?update=true`. The device checks for updates itself, over
the internet; one that cannot reach the internet never offers one.

A profile may also say where its reports carry the firmware the device runs now -
`"device": { "swVersion": "device_info.ver" }` - and the hub then writes a changed version on the
device's row as it hears it, so the device page follows an update without the device being added
again.

The logo rides inside the catalogue the hub serves, as a data URL, so it must be an `.svg` or a
`.png` and at most 64 KiB; anything else fails the vendor at startup. Draw a monogram in the
vendor's colour - nobody's trademark -; the interface draws the same monogram itself for a vendor
that ships no logo at all.

## `discovery.json` - how the devices are found

A vendor whose devices announce themselves says how in `discovery.json`, and the hub does the same
six steps for every vendor that has one: **listen**, **match**, **probe**, **identify**, then the
two that are the hub's - **associate** the model with a driver through its `modelCodes`, and
**propose** the device on the integrations page. No address is swept and no port scanned: the
hub hears announcements, asks the question the protocol exists for, and probes an address only
because a device announced it there.

```json
{
  "listen": [{ "mdns": "_shelly._tcp" }, { "mdns": "_http._tcp" }],
  "match": [{ "path": "instance", "startsWith": "shelly" }],
  "probe": { "transport": "http", "op": "get", "args": { "path": "/shelly" }, "timeoutMs": 10000 },
  "identity": {
    "externalId": ["id", "mac"],
    "name": "name",
    "model": ["model", "type"],
    "swVersion": ["ver", "fw"]
  }
}
```

- `listen` - up to four sources: `{ "mdns": "_name._tcp" }`, a service the platform browses for,
  or `{ "module": "./lan/discovery.js" }`, a listener of the vendor's own (below). An mDNS
  announcement is read as `{ service, instance, host, address, port, txt: { … } }`, and the device
  is reached at `address`, with `:port` when it is not 80.
- `match` - conditions in the claim's grammar, all of which must hold of the announcement: for a
  service other vendors announce too. `startsWith` is a prefix compared without regard to case -
  what Shelly needs on `_http._tcp`, which every printer and NAS announces as well.
- `probe` - optional: a request, in a transport's words - the vendor's own or a platform one -
  asked of the announced address with the vendor's saved settings beneath it. Its answer is what
  `identity` reads, and it should be the same question the drivers' `discovery.probe` asks, so the
  id discovery finds is the id identification then insists on. Without one, `identity` reads the
  announcement, and must then say where the model is: without a probe the drivers' own claims have
  nothing to read. `timeoutMs` (0.5 to 30 s, four when absent) gives slow devices longer and is
  handed to the transport as its own `timeoutMs`: a Shelly on a weak Wi-Fi link took eight seconds
  to answer its first request after a silence.
- `identity` - paths to the model code, the id, the name and the firmware version. Only the model
  is ever required. A field may be a list of paths, tried in order, for generations that answer
  in different words: a Shelly Gen1 says `type`, `mac` and `fw` where later ones say `model`,
  `id` and `ver`.
- `adopt` - who adds a device found: `owner` (the default) proposes it on the vendor's
  page to adopt; `automatic` has `api` add it as soon as the hub proposes it, named as it named
  itself, with the id the add form would have offered - for devices the owner already chose
  somewhere else: a Zigbee device paired with Zigbee2MQTT, a mower bound to an ECOVACS account.
  Such a vendor's page has no **Add device**, no **Discover devices** and nothing to adopt, and a
  device removed there comes back while the vendor still lists it.
- `pairing` - `{ "driver": "bridge", "open": "permit_join", "close":
"permit_join_stop", "state": "pairing" }`: the entities of one of the
  vendor's drivers pairing is run by, by object id - the button that opens it, the one that closes
  it, and the text sensor saying `enabled` while it is open, with when it closes in its `endsAt`
  attribute. The vendor's page offers them as **Pair devices** / **Stop**, read live, in place of
  looking for devices.

The hub asks mDNS from every network interface of the machine, one question a packet, when it
starts - at 0, 1, 3, 8, 15, 30 and 60 seconds, since a question over multicast is easily lost - and
again every `HUB_DISCOVERY_QUERY_INTERVAL_MS`; an answer that names a device without its SRV, TXT
or A record is completed by asking for that record by name. An address that did not answer its
probe is asked again on a timer - after five seconds, then thirty, then sixty - rather than at the
next announcement, and an address already added is not probed at all. An owner can have it look
**now**: **Discover devices** on a vendor's page asks that vendor again every second or two for
thirty seconds (`POST /api/v1/discovery/scan`, the hub's `discover` method, which answers how long
it looks), and the page then says what it found. A vendor with no `discovery.json` offers no
button, and its devices are added by address. What is found is shown on the vendor's own page,
above its devices.

The model code is looked up in every driver's `modelCodes`; with a probe, the driver's own claim
must also take what the probe returned - a Pro 3EM reports one code in both its profiles and only
the triphase one is the `3em` driver's - and when no driver maps the code, the drivers' own claims
decide, in load order. Two drivers may map one code only when the vendor probes - a Shelly 2PM
reports one code as relays or as a cover, and each driver's claim reads its profile. A device no
driver takes is not proposed, and the hub logs its model once at info: it is the answer to "why is
my device not found". A `discovery.json` that does not load leaves the vendor loaded without discovery, and the
failure names the file.

**Matter devices.** The house's Matter devices are commissioned on the platform's Brokers page,
with the code the maker's app - or Google Home, Apple Home, Alexa - shares, and each is then added
at once to the vendor whose `matter` rules take it:

```json
{
  "matter": {
    "match": [{ "path": "vendorId", "equals": 5264 }],
    "model": "productId"
  }
}
```

- `match` - at least one condition, all of which must hold of who the device says it is: its
  `vendorId` and `productId` (numbers), `vendorName`, `productName`, `productLabel`, `nodeLabel`,
  `serialNumber`, `uniqueId`, `hardwareVersion`, `softwareVersion` (numbers) and their `…String`
  texts, `macAddresses` (a list of `aa:bb:cc:dd:ee:ff`), `deviceTypes` and `clusters` (lists of
  numbers), `isBridge` and `isBridged`. A field the device does not say is `null`. The vendor id is
  the one to rule on: the CSA assigns it to the maker, and it does not change with a name.
- `model` - where the device says its model, looked up in the `modelCodes` of the vendor's drivers
  that say `"kind": "matter"`; `productId` when absent. A model no driver maps goes to the vendor's
  Matter driver when it has only one. Matter devices are added on their own, with no one to pick a
  model: a Matter driver that lists models must map every product in `modelCodes`, or a product
  it misses is never added. A driver that lists none takes them all, under its own name.

A vendor may have `matter` alone, with no `listen`. A device behind a Matter bridge is a device of
its own, ruled on by what the bridge says of it. A device that more than one vendor's rules take,
and one that none takes, is added as the platform's own Matter device, and the Brokers page says
which vendors want it. One added as the platform's before the vendor was installed becomes the
vendor's once it is, with its entities. Removing a Matter device from the house takes it off the
house's fabric; it stays in the other apps it was shared from.

**A listener of the vendor's own** is a module - plain JavaScript, like a transport, handed the
same SDK - whose default export returns `{ listen(signal, context), scan?() }`: an async iterable
of sightings, `{ config: { host }, payload }`, reported as they happen until the signal ends it,
and, optionally, a way to ask the network again now, which the owner's scan calls - its answers
arrive through `listen` like every other. `context.settings()` reads what the owner saved
for the vendor, secrets opened, for a listener that asks a cloud which devices an account has; read
it at every pass and a change is heard without the listener being started again. It listens and
reports; which driver a device belongs to stays the business of `discovery.json`. A sighting at a
public address is not followed.

The context also takes two things the vendor's page shows, both optional for the hub to
offer, so a listener calls them as `context.status?.(…)`:

- `status({ level, message })` - how listening goes: `ok`, `warning` (listening, and hearing
  nothing it should - Zigbee2MQTT silent on the broker), `error` (it cannot listen - the broker
  refuses). The last one said stands; anything but `ok` is a callout on the vendor's page, with the
  way to the vendor's container log.
- `passedOver([{ id, name, model, reason }])` - every device it heard and does not report, the
  whole list each time: one still being paired, one its program does not support. The page lists
  them under **Seen but not added**, with the reason, beside the devices the hub heard that no
  driver takes, which the hub adds on its own.

## `account.json` - the account the devices are reached through

A vendor whose devices are reached through an account - a cloud's, an app's - names an
`account.json` in its manifest (`"account": "./account.json"`) instead of asking for an email and
a password in its `setup.json`:

```json
{
  "name": "ECOVACS HOME account",
  "help": "The account the ECOVACS HOME app signs in with.",
  "fields": {
    "fields": [
      { "key": "email", "type": "text", "label": "Email", "isRequired": true },
      { "key": "password", "type": "secret", "label": "Password", "isRequired": true }
    ]
  },
  "identity": "email",
  "module": "./cloud/sign-in.js"
}
```

`fields` is a setup group - constants and fields, `shownWhen` and all - and `identity` the field
the account's card is named by, which may not be a secret. The vendor's page shows an **Account**
card: each account signed in to, where it stands, **Sign in again** and **Remove**, and **Add
account** - a vendor holds as many as the house has. There is no Configure for an account.

The module default-exports a function of the SDK returning `sdk.defineAccount({ signIn, answer,
poll?, signOut? })`. Each is handed a `{ signal }` it must honour - a step has a minute - and
answers a step:

- `{ kind: 'connected', identity: { id, label }, session }` - signed in: `id` is the account's own
  at its cloud, the one a device names; `session` what to keep for the next start - tokens, a user
  id - sealed by the hub;
- `{ kind: 'ask', message, fields, pending }` - the cloud wants more: a code it emailed, a second
  factor. `fields` are setup fields; `pending` is anything the module needs to carry on, handed
  back to `answer(pending, answers)` - kept in the hub's memory only, for fifteen minutes;
- `{ kind: 'link', message, url, code?, pollMs, pending }` - the owner approves on the cloud's
  page; `poll(pending)` is called every `pollMs` until it answers something else;
- `{ kind: 'failed', message, field? }` - it did not work; `field` names the one to correct.

A throw is a `failed` step with the error's message. What the owner typed reaches `signIn` with
its secrets opened; the hub keeps it sealed with the account, so a transport can sign in again
when the session expires.

**At run time**, a device of the account names it in its configuration (`transportConfig.account`

- the listener's sighting says so), and its transport is handed `context.account`: `{ id, label,
status, credentials, session, update(session), needsSignIn(message) }`. Keep a renewed session
  with `update`; when the cloud wants the owner again - a new code - call `needsSignIn` with a
  sentence, and the card asks. A listener gets `context.accounts()`, every account signed in to,
  read at every pass. Signing in or out starts the vendor's instances again and asks its listener
  to look now (`scan`), so an `automatic` vendor's devices appear the moment the account is
  connected.

## `setup.json` - what adding a device asks

`driver.json` says what a driver is and `profile.json` says how it maps a device; the driver's
`setup.json` says what the form asks when an owner adds a device by hand. The interface builds
the form from it, the API checks what was typed against it, and the hub never reads it for
anything else - so a driver that needs a new field adds a line here and nothing else changes.

A **vendor** may ship a `setup.json` of its own, in exactly the same grammar, for what every
device of theirs shares - a cloud API key, an account: Govee asks for its optional cloud account
there, Zigbee2MQTT for its coordinator. When one does, the interface asks for it once, from the
vendor's page, and refuses to add a device until it has been given; the hub then puts the vendor's answers under every instance it starts, lowest first:
the vendor's settings, then the driver's constants, then what the owner typed for that device.
A vendor-level field must therefore be a key the transport understands, the same as a
driver-level one.

```json
{
  "transport": {
    "constants": { "username": "bblp", "shouldVerifyCertificate": false },
    "fields": [
      {
        "key": "url",
        "type": "text",
        "label": "Printer address",
        "isRequired": true,
        "placeholder": "mqtts://192.168.1.60:8883",
        "pattern": "^mqtts://[^/ ]+$",
        "patternMessage": "Must start with mqtts://, the printer only speaks TLS.",
        "help": "The printer's LAN address on port 8883."
      },
      {
        "key": "password",
        "type": "secret",
        "label": "Access code",
        "isRequired": true,
        "minLength": 8,
        "maxLength": 8
      }
    ]
  },
  "options": { "fields": [] }
}
```

Two groups, one per column of `registry.integrations` (or of `registry.integration_vendors`,
for a vendor's own): `transport` becomes `transport_config`, the settings the transport opens a
connection with, and `options` becomes `options`, whatever the integration itself takes (it may
be left out). Each group has:

- `constants` - values the bundle fixes and the form never shows. They are written into the row
  by the API beside what the owner typed, and refused if a client sends them: a printer that only
  ever logs in as `bblp` says so here, and nobody can turn certificate checking back on for it.
- `fields` - what the form asks, in this order. Every field has a `key` (a camelCase
  identifier, the JSON key it is stored under), a `label`, an optional `help` line and
  `isRequired`. The `type` decides the control and the checks:

  | Type      | Control              | Checks                                                                                |
  | --------- | -------------------- | ------------------------------------------------------------------------------------- |
  | `text`    | text field           | `minLength`, `maxLength` (512), `pattern`, `patternMessage`, `default`, `placeholder` |
  | `secret`  | password field       | as `text`; **sealed** before it is stored, never served back                          |
  | `number`  | number field         | `min`, `max`, `isInteger`, `unit`, `default`, `warnBelow` + `warning`                 |
  | `boolean` | on/off switch        | `default`                                                                             |
  | `choice`  | select               | `choices: [{ value, label }]`, `default`                                              |
  | `list`    | comma-separated text | `minItems`, `maxItems` (64), `pattern` and `patternMessage` per item                  |

A `number` with `warnBelow` accepts a smaller value but says, under the field, what it costs - the
bundle's `warning`, or that it is below what is advised.

**A field asked only after a choice.** `shownWhen: { "key": "connection", "equals": ["dongle"] }`
shows a field only while an earlier `choice` or `boolean` of the same group holds one of the
values - the choice's `default` counting when nothing was picked. The field it names must come
first, must itself be always asked, and must be able to hold every value listed; the bundle fails
to load otherwise. A field a choice hides is neither shown, required, defaulted nor sent, and the
API drops its value from a new configuration, so a SolaX inverter read over Modbus is never asked
for its dongle's password:

```json
{
  "fields": [
    {
      "key": "connection",
      "type": "choice",
      "label": "Connection",
      "choices": [
        { "value": "modbus", "label": "Modbus TCP" },
        { "value": "dongle", "label": "Web API" }
      ],
      "default": "modbus"
    },
    {
      "key": "unitId",
      "type": "number",
      "label": "Modbus unit ID",
      "default": 1,
      "shownWhen": { "key": "connection", "equals": ["modbus"] }
    },
    {
      "key": "password",
      "type": "secret",
      "label": "Web page password",
      "shownWhen": { "key": "connection", "equals": ["dongle"] }
    }
  ]
}
```

When discovery filled the choice, the adopt dialog does not ask it, nor the fields its answer
hides.

**How often a polled device is read** is the owner's choice. A driver whose profile reads the
device on a timer - a subscription with `op: "poll"` and `everyMs` - declares `polling`, in whole
seconds:

```json
{
  "transport": { "fields": [] },
  "polling": { "default": 30, "min": 5, "warnBelow": 10 }
}
```

The hub turns it into the option `pollInterval`, "Update every … s": required, never 0 (`min` is
at least 1), up to `max` (a day when absent), filled with `default`, and warning below
`warnBelow`. The API stores and changes it like any option, and a change restarts the instance. At
runtime the chosen interval replaces `everyMs` in every subscription of the profile that has one; a
subscription without `everyMs` - a topic, a push - is left alone, and the transport's own floor
still holds. `default × 1000` must be the profile's `everyMs` (what a device added before the option
existed is read at), and a driver that does not poll must not declare it - a vendor's tests should
check both, as every vendor written with the platform does. Never declare a field called `pollInterval` yourself. A push transport's periodic full
re-read (Shelly's `status`) is a safety net, not a poll, and has no `polling`.

A `secret` value is encrypted with `NEBULA_SECRETS_KEY` by the API before it reaches the
database and decrypted by the hub when the instance starts; the interface only ever learns that
one is kept. A `pattern` is a regular expression source and must compile, or the bundle fails to
load - which is the point: a typo here is found at startup rather than on somebody's form. Give
it a `patternMessage` whenever the pattern encodes a fact about the device: the form shows that
sentence under the field, where the pattern itself would tell a person nothing.

**Test** in the interface opens the bundle's transport once with what was typed and closes it
again, keeping nothing: for MQTT that is one session, for HTTP one request to the address. The
verdict is a sentence in the transport's own words, so `Not authorized` and `ECONNREFUSED` send
an owner to different places. When the vendor's `discovery.json` probes, the Test asks the device
that question too, and the form preselects the model it says it is.

**What the `http` transport takes.** A request template's `op` is the verb - `get`, `post`,
`put`, `patch`, `delete` - with `path`, `query` and a `body` sent as JSON; a `poll` names its verb
in `method`. Beyond `host`, `isSecure`, `timeoutMs` and basic auth (`username`, `password`), the
transport configuration takes what a setup fills and the profile never sees: a `token` (a secret
field), sent in the header `tokenHeader` names (with `tokenPrefix` in front, `Bearer ` for one) or
put into the path by `pathPrefix`, where `{token}` stands for it - `/api/v1/{token}` - and
`shouldVerifyCertificate: false` for a device that signs its own certificate. The bundle fixes
the header, the prefix and the certificate check as constants; the owner types the token.

**Save** creates the device and starts it. The hub has no claim for a device it has never heard
from, so it reports the instance `identifying` and listens with the driver's `discovery` -
the MQTT subscription, the probe of the address - until the driver claims what answers; then it
asks `core` to complete the device's row with the serial, the claim and the entities, and the
instance is `running`. The claim stays on the row, so the next start binds the device without
listening again. A device that stays `identifying` is one the hub cannot hear, or one no driver
claims: the hub logs what answered and what it said of itself, and each bundle below says what
to look at.

## A transport of the vendor's own

A vendor whose devices speak a protocol the hub does not may ship the transport itself. The
manifest names it - `"transports": { "rpc": "./rpc/transport.js" }` - and the hub loads the
module when it loads the vendor, before the drivers, and registers what it builds as
`<vendor>/<name>`: `shelly/rpc`. Its drivers then say `"transport": "shelly/rpc"`, and nothing
else about them changes: they stay declarative, and the profile's requests are in the new
transport's own words.

A transport of the vendor's own is named nowhere a person would recognise - `shelly/rpc` means
nothing on the vendor's card - so the manifest may say which **wires** it goes over, in the long
form of the entry: `{ "module": "./rpc/transport.js", "wires": ["http"] }`. The card shows one mark
per wire, beside the marks of the platform's own transports the drivers speak (`http`, `mqtt`,
`ble`, `zigbee`). The wires are `http`, `mqtt`, `ble`, `zigbee`, `udp` (a protocol of the
device's own in plain datagrams on the network, as Govee's LAN API) and `modbus` (Modbus TCP).
zigbee2mqtt's transport says `["mqtt", "zigbee"]`: it listens on the broker, and its devices are
Zigbee. A bare path declares none, and the card shows no mark for that transport.

The module is TypeScript in `src/`, built by `nebulahome-integration build` into the JavaScript
the manifest names, and its default export - typed with `defineTransportModule` - is a function
the hub calls with the **SDK**, the runtime's pieces a transport needs, since the bundle cannot
import them:

| `sdk.`               | What                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `version`            | the runtime version, the one `manifest.sdk` was matched against                    |
| `z`                  | the runtime's zod, so the transport's settings validate as the hub's do            |
| `defineTransport`    | the contract the platform's own transports are written against                     |
| `openWebSocket`      | a WebSocket the hub keeps open: reconnection with a doubling pause, resets         |
| `openUdpSocket`      | a UDP socket the hub binds, joins to a multicast group, and closes with the vendor |
| `openMqtt`           | an MQTT session with a client certificate, for a vendor's own broker               |
| `defineStreamSource` | the contract a camera's stream source is written against                           |
| `openRtsp`           | an RTSP(S) session over TCP, yielding a camera's H.264 as it comes                 |
| `platform.mqtt`      | the platform's own MQTT broker, or null on an installation without one             |
| `defineAccount`      | the contract an account's sign-in module is written against                        |
| `codecs.lzma`        | unpacks an LZMA stream in the alone format, as some clouds pack maps               |
| `images.png`         | encodes a picture of a palette as a PNG, for an image entity                       |
| `logger`             | the hub's logger, for what happens outside a connection                            |

`openWebSocket` also takes `headers` - sent on every handshake and never logged, or a
function called before each attempt, for a token that expires - `ping: { everyMs, timeoutMs }`,
which drops and reopens a socket whose peer stopped answering, and `tls: { rejectUnauthorized }`;
and `onClose` is told the close code and, for a handshake the server refused, its HTTP `status`,
so a vendor whose credentials are turned down can close the socket and ask for a new sign-in
rather than retry for ever.

The transport it returns is the one the platform's `http` and `mqtt` are:
`connectionKey`, `connect`, `scan`, `probe`, and a `configSchema` for what the driver's
`setup.json` asks. `scan` and `probe` take a last argument, `{ account }`: the account
the configuration names, as `connect` is handed it in `context.account`. Its `id` must be `<vendor>/<name>`, or the loader refuses the vendor naming
both. It is **code**, so the vendor sits at the tier a code driver does - reviewed before a
catalogue carries it; `verifyVendor` is where the hub asks. Its types come from
`@nebulahome/integration-sdk`, and `pnpm typecheck` holds it to them.

## A camera's picture

A camera's live picture is not state and goes through no transport: it is frames, for as long
as somebody watches, over a connection of its own. So a vendor with cameras ships a **stream
source** beside its transports - `"streams": { "camera": "./camera/stream.js" }` in the
manifest, registered as `<vendor>/<name>` - and a profile's camera entity names it and says what
to read:

```json
{
  "domain": "camera",
  "objectId": "chamber_camera",
  "capabilities": { "camera": { "hasSnapshot": false, "hasStream": true } },
  "state": {
    "camera": {
      "isStreamAvailable": {
        "path": "ipcam.rtsp_url",
        "map": { "disable": false },
        "default": true
      }
    }
  },
  "stream": { "source": "bambulab/camera", "args": { "kind": "rtsp" } }
}
```

The module's default export takes the SDK and returns `sdk.defineStreamSource({ id,
configSchema, open })`. `open(config, args, sink, signal)` is handed the instance's transport
settings, secrets opened, and the profile's `args`; it says once what the stream carries -
`sink.describe({ kind: "jpeg" })` or `{ kind: "h264", codec: "avc1.640028" }` - then hands
over each frame with `sink.frame({ data, isKey, timestampUs })`: a JPEG, or an H.264 access unit
in Annex B with its parameter sets before a key frame. `sdk.openRtsp` does the RTSP for a camera
that speaks it. Nothing is decoded or transcoded on the hub: the frames go to the browser, which
decodes them (WebCodecs for H.264), and a stream runs only while a viewer keeps asking for it.

## A picture that changes

A robot's map, a printer's plate: a picture the device's state carries, drawn again
when it changes. A profile's `image` entity says where in the payload it is and what it is:

```json
{
  "domain": "image",
  "objectId": "map",
  "capabilities": { "image": {} },
  "state": {},
  "image": {
    "path": "mapSvg",
    "contentType": "image/svg+xml",
    "encoding": "utf8",
    "minIntervalMs": 5000
  }
}
```

`contentType` is `image/svg+xml`, `image/png` or `image/jpeg`; `encoding` is `utf8` for an SVG's
text or `base64` for bytes. The hub keeps the picture in memory - at most 700 KB - and publishes
only which one it is, `{ contentType, revision }`, the revision a digest of the bytes, at most
every `minIntervalMs` (2 s when not said) however often the payload changes. The interface reads
the bytes from `GET /api/v1/entities/:id/image`, and draws them again when the revision moves. A
picture's changes are not written to the state history.

An SVG is shown in an `<img>`: nothing in it runs, and nothing outside it is fetched - a raster
goes in as a `data:` URI. `sdk.images.png` makes one out of cells and a palette, and
`sdk.codecs.lzma` unpacks what a cloud packed; ECOVACS's `src/cloud/map.ts` does both.

**A command may be several messages.** On the `mqtt` transport, `"payloads": [ … ]` in place of
`"payload"` publishes each in order on the one topic - a device whose one switch is two nodes to
its firmware, like a Bambu H2's two chamber lights, is switched by one command.
