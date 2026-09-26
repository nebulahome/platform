# Bundles under development

The product ships with no integration: a production hub reads only the data directory's
`hub/integrations`, where a download from the integrations catalogue will land. Until that
catalogue exists, the bundles written in this repository live here, and outside production the
hub reads this directory beside the data directory - `HUB_DEV_BUNDLE_DIR` defaults to it - so
anything here is loaded at startup without anybody installing it. A bundle with the same id in
`hub/integrations` replaces the one here, and the log says so. A production image does not
contain this directory.

Loaded means present and offering to connect to devices; nothing is connected until somebody
adds one. Adding one is the whole of it: a device added from the vendor's page is an instance of its
driver and a row in the registry under one id, and the hub identifies the hardware behind it
by itself. A vendor with a `discovery.json` is also **found**: the hub listens for its devices
announcing themselves and the integrations page offers each one it hears to adopt - which is
adding it, with the driver, the model and the address already filled in. Nothing is added
until the owner says so.

A bundle is a **vendor directory** holding one **driver directory** per profile or entry point:

```
shelly/
├── manifest.json       who the vendor is                            ← always
├── logo.svg            the mark the interface shows (.svg or .png)  ← optional
├── setup.json          what every device of the vendor shares       ← optional
├── discovery.json      how its devices are found unasked            ← optional
├── README.md           what the devices are, what is unverified     ← always
├── rpc/transport.js    a transport of the vendor's own              ← optional
└── dimmer-pm/
    ├── driver.json     transport, models, which file holds it       ← always
    ├── setup.json      what adding one device asks                  ← always
    └── profile.json    the declarative mapping (or index.js, code)  ← one of the two
```

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
  "version": "2.2.0",
  "sdk": "^1.0.0",
  "name": "Shelly",
  "description": "Shelly devices of every generation on your own network: Gen2, Gen3 and Gen4 spoken to over their RPC interface, Gen1 over its HTTP API and the CoIoT packets it sends on every change.",
  "url": "https://shelly.com",
  "color": "#3B9DFF",
  "logo": { "path": "./logo.svg", "padding": 4 },
  "internetRequired": false,
  "transports": { "rpc": "./rpc/transport.js", "gen1": "./gen1/transport.js" }
}
```

`logo` is a path relative to the bundle, either bare - `"logo": "./logo.svg"` - or, as above,
with `padding` (0 to 16, default 0): extra room, in pixels, the interface leaves around the logo
inside its tile. Every logo already gets a small margin; this is on top of it, for a mark drawn
to the very edge of its file. It cannot ask for less than the margin, only for more.

`driver.json` says how one profile is loaded and **which models it drives**. The list is what the
owner picks from when adding a device: Bambu Lab's one `printer` driver lists six printers, so the
form offers six choices and the row remembers the one picked, though all six run the same
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

`transport` is a platform transport - `http`, `mqtt` - or one the driver's own vendor ships,
named after the vendor: `shelly/rpc`. Never another vendor's: vendors load in no particular
order, and a driver leaning on another's transport would load or not by luck.

`defaultIcon` names the icon a device of this driver starts with, by its id in the platform's
icon catalogue (`packages/icons/catalogue.json` lists the platform's own ids - `light`,
`relay`, `printer`, `sensor`… - and every lucide icon is there under its own name). The owner
may pick another per device. The hub does not check the id; the API does when a device is
added, and falls back to no icon with a warning rather than refusing the device, so a typo in
somebody's bundle costs a blank tile and not the device. `shipped-bundles.test.ts` does check
the two here.

Each entity in `profile.json` may name its own `icon` the same way - `"icon": "thermometer"` on
a temperature sensor - and it is the bundle's first word only: the owner may rename an entity
or pick another icon from the devices page, and identifying the hardware again does not put the
bundle's back. An entity that names none shows a blank tile until the owner picks one.
`shipped-bundles.test.ts` checks every entity icon the two bundles here name.

The format is `packages/package-runtime` and the ceiling it enforces is deliberate: every object
is strict and every expression is a path, so a profile cannot become a program one feature at a
time. A device whose entities are not known in advance needs a code driver instead. Two forms go
as far as the ceiling allows, and no further: a claim may ask that a path be **one of** a list of
values - `{ "path": "model", "oneOf": ["S3DM-0010WW", "S4DM-0010WW"] }`, which is how one driver
serves a family of models - and a state may be **looked up in a table** -
`{ "path": "'cover:0'.state", "map": { "opening": "opening" }, "default": "stopped" }`, which
renames what a device says into what a capability accepts. A list is membership, not an `or`
between paths; a table renames and cannot compute.

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
`.png` and at most 64 KiB; anything else fails the vendor at startup. The two that ship are
monograms in the vendor's colour - nobody's trademark - and the interface draws the same
monogram itself for a vendor that ships no logo at all.

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

**A listener of the vendor's own** is a module - plain JavaScript, like a transport, handed the
same SDK - whose default export returns `{ listen(signal), scan?() }`: an async iterable of
sightings, `{ config: { host }, payload }`, reported as they happen until the signal ends it, and,
optionally, a way to ask the network again now, which the owner's scan calls - its answers arrive
through `listen` like every other. It listens and reports; which driver a device belongs to stays
the business of `discovery.json`. A sighting at a public address is not followed.

## `setup.json` - what adding a device asks

`driver.json` says what a driver is and `profile.json` says how it maps a device; the driver's
`setup.json` says what the form asks when an owner adds a device by hand. The interface builds
the form from it, the API checks what was typed against it, and the hub never reads it for
anything else - so a driver that needs a new field adds a line here and nothing else changes.

A **vendor** may ship a `setup.json` of its own, in exactly the same grammar, for what every
device of theirs shares - a cloud API key, an account. Neither vendor here does. When one does,
the interface asks for it once, from the vendor's page, and refuses to add a device until it has
been given; the hub then puts the vendor's answers under every instance it starts, lowest first:
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
existed is read at), and a driver that does not poll must not declare it - `shipped-bundles.test.ts`
checks both. Never declare a field called `pollInterval` yourself. A push transport's periodic full
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

The module is plain JavaScript - an installed bundle is loaded as it is, with no build step - and
its default export is a function the hub calls with the **SDK**, the runtime's pieces a transport
needs, since the bundle cannot import them:

| `sdk.`               | What                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `version`            | the runtime version, the one `manifest.sdk` was matched against                    |
| `z`                  | the runtime's zod, so the transport's settings validate as the hub's do            |
| `defineTransport`    | the contract the platform's own transports are written against                     |
| `openWebSocket`      | a WebSocket the hub keeps open: reconnection with a doubling pause, resets         |
| `openUdpSocket`      | a UDP socket the hub binds, joins to a multicast group, and closes with the vendor |
| `openMqtt`           | since 1.2: an MQTT session with a client certificate, for a vendor's own broker    |
| `defineStreamSource` | since 1.2: the contract a camera's stream source is written against                |
| `openRtsp`           | since 1.2: an RTSP(S) session over TCP, yielding a camera's H.264 as it comes      |
| `logger`             | the hub's logger, for what happens outside a connection                            |

The transport it returns is the one the platform's `http` and `mqtt` are:
`connectionKey`, `connect`, `scan`, `probe`, and a `configSchema` for what the driver's
`setup.json` asks. Its `id` must be `<vendor>/<name>`, or the loader refuses the vendor naming
both. It is **code**, so the vendor sits at the tier a code driver does - reviewed before a
catalogue carries it; `verifyVendor` is where the hub asks. The hub type-checks the ones that
ship here (`checkJs`), so write the types in JSDoc and start the file with `// @ts-check`.

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
  "stream": { "source": "bambu-lab/camera", "args": { "kind": "rtsp" } }
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

**A command may be several messages.** On the `mqtt` transport, `"payloads": [ … ]` in place of
`"payload"` publishes each in order on the one topic - a device whose one switch is two nodes to
its firmware, like a Bambu H2's two chamber lights, is switched by one command.

## shelly

Twenty-eight drivers, one per layout of components, across Shelly's generations: relays, plugs,
dimmers, covers, energy meters and input boxes, each driver listing the models it drives. The
bundle ships two transports of its own.

- **`shelly/rpc`** - nineteen drivers for **Gen2** (Plus, Pro), **Gen3** and **Gen4**: Shelly's
  JSON-RPC over the WebSocket every such device serves, with the status pushed as it changes and
  the digest authentication the devices ask for. A generation with the same components as another
  is more models on the same driver: a Plus 1PM, a Pro 1PM and a 1PM Gen3 are one family.
- **`shelly/gen1`** - nine drivers, `gen1-…`, for the **Gen1** relays, plugs, the 2.5, the
  dimmers, the EM and 3EM and the i3: plain HTTP (`/status`, `/relay/0?turn=on`), with basic
  authentication when a login is on. The CoAP packet a Gen1 multicasts on every change (CoIoT),
  heard on the SDK's UDP socket, is taken as the signal to read `/status` at once; a poll every
  30 s, the owner's to change, is the safety net.

A driver claims a device by its hardware code, one of a list: `model` over RPC, `type` on a Gen1.
Every Shelly is found the same way - `GET /shelly`, which every generation answers without a
password - and the codes each driver maps tell which family and model it is.

Every driver links to the device's own web page on port 80, and exposes a **firmware update**
sensor and an **install** button (see _Firmware updates_ above).

Its own README says what the devices are, how the transports treat them, which models each
family takes, and what has not been checked against hardware - above all the model codes, and
the one-line fix when a device on the network is not claimed.

## sonoff

One driver, `diy-plug`, for Sonoff relays in **DIY mode** - BASICR3, RFR3, MINI, MINIR2 - over
the HTTP API the firmware serves on port 8081: every request a POST with a JSON body. Found over
mDNS (`_ewelink._tcp`), from the TXT record alone: it says the device's id and that it is a
`diy_plug`, which names the driver but not which of the four it is, so the owner picks.

## plex

One driver, `server`: a Plex Media Server and how many streams it is playing, polled from the
server with the owner's `X-Plex-Token`, which the transport sends in that header. Not discoverable:
Plex announces itself with a protocol of its own (GDM), not over mDNS; it is added by address.
Links to Plex Web (`:32400/web`). No firmware entities yet: the server says an update is waiting at
`/updater/status`, but a declarative profile reads every poll into every entity, and that answer
carries a `MediaContainer.size` of its own that would overwrite the activity count.

## nanoleaf

One driver, `panels`, for the controllers of the OpenAPI - Light Panels, Canvas, Shapes, Elements,
Lines - on port 16021, with the token in the path (`/api/v1/<token>/…`) and the state written as
a PUT. Found over mDNS (`_nanoleafapi._tcp`), the model read from the TXT record: the controller
tells nothing to a caller without its token, so adopting one asks for it. No firmware entities:
the OpenAPI reports the version and offers no update over the LAN.

## govee

One driver, `light-lan`, for Govee lights with **LAN Control** switched on in the Govee app, over
the vendor's own `govee/lan` transport: JSON datagrams over UDP, a status asked and answered, and
the commands for on, off, brightness, colour temperature and colour. Every command is followed by
a status request, and a light seen changing is asked every second for a while, since the LAN API
pushes nothing. Given the owner's Govee account (optional, in the vendor's setup), the bundle also
listens to Govee's cloud, which pushes what a light shows as it changes; commands stay on the LAN.
Found by its own listener, which asks the LAN API's multicast scan; the transport and the listener
share the one socket every answer comes back to. No firmware entities: the LAN API reports
versions only.

## bambu-lab

Four drivers, one per family of Bambu Lab printers - the X1s; the P2S and H2S; the dual-nozzle
H2D, H2D Pro, H2C and X2D; the P1s, A1s and A2L - in LAN mode, over the MQTT broker the printer
runs itself. The chamber camera, the lights, the temperatures (packed ones read with `bits`), the
fans, the AMS, the print in progress, and pause, resume and stop. The first bundle with a stream
source: RTSPS on port 322 for the families that have it, the JPEG stills on port 6000 for the P1s
and A1s. Found by the SSDP announcements the printers make, with the model code mapped to its
driver. Its own README says what the printer is and what has not been checked against one.

## solax

Six drivers for SolaX Power inverters - grid-tie, hybrid with a battery, AC-coupled retrofit -
and the X3-EVC charger, over three transports the vendor ships. `solax/modbus` is a read-only
Modbus TCP client (functions 03 and 04, plain MBAP or RTU frames over TCP) for a Pocket WiFi 3.0,
the inverter's own Ethernet port or an RS485 adapter, telling the family by the serial number's
prefix, one socket per address for the whole hub. `solax/local` asks the Pocket WiFi or Pocket
LAN dongle's web API on port 80, the password being the dongle's registration number, and tells
the family by the `type` it answers with (and how many registers, where two families share a
code). The four inverter drivers name `solax/inverter`, which hands each request to one of those
two as the form's **Connection** says - Modbus TCP by default, the fields of the other way hidden
with `shownWhen` - and makes their payloads the same, the inverter known by its own serial either
way; the retrofit is read over Modbus only and the charger through its dongle only. Both decode
the registers - scales, signs, 32-bit pairs, codes standing for words - into named values, so one
profile reads an inverter either way, once per interval: one HTTP request, or one read per block
of up to 100 registers, never one per entity. Power is signed the way SolaX signs it - feed-in and
battery charge positive - and the README says how to set the energy card's switches for it.
Neither announces itself, so discovery sweeps the house's networks - their real netmask, up to a
/22 - on port 502, then port 80 where 502 gave nothing, and offers whatever answers as SolaX with
its Connection chosen. No firmware entities, nothing written. Its own README
lists every family, where the tables came from (the `solax` library, MIT; the
`homeassistant-solax-modbus` integration, Apache-2.0) and what has not been checked against a
real inverter: all of it.
