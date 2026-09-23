# Bundles that ship with the hub

`HUB_BUNDLE_DIR` defaults to this directory, so anything here is loaded at startup without
anybody installing it. That is what "installed by default" means for an integration: the driver
is present and offering to connect to devices, and nothing is connected until somebody adds one.
Adding one is the whole of it: a device added from the vendor's page is an instance of its
driver and a row in the registry under one id, and the hub identifies the hardware behind it
by itself - there is no scan to start and nothing to adopt.

A bundle is a **vendor directory** holding one **driver directory** per profile or entry point:

```
shelly/
├── manifest.json       who the vendor is                            ← always
├── logo.svg            the mark the interface shows (.svg or .png)  ← optional
├── setup.json          what every device of the vendor shares       ← optional
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
  "version": "2.0.0",
  "sdk": "^1.0.0",
  "name": "Shelly",
  "description": "Shelly Gen3 and Gen4 devices on your own network, each spoken to directly over its RPC interface.",
  "url": "https://shelly.com",
  "color": "#3B9DFF",
  "logo": { "path": "./logo.svg", "padding": 4 },
  "internetRequired": false,
  "transports": { "rpc": "./rpc/transport.js" }
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
  "defaultIcon": "light",
  "kind": "declarative",
  "profile": "./profile.json",
  "setup": "./setup.json"
}
```

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

The logo rides inside the catalogue the hub serves, as a data URL, so it must be an `.svg` or a
`.png` and at most 64 KiB; anything else fails the vendor at startup. The two that ship are
monograms in the vendor's colour - nobody's trademark - and the interface draws the same
monogram itself for a vendor that ships no logo at all.

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
  | `number`  | number field         | `min`, `max`, `isInteger`, `unit`, `default`                                          |
  | `boolean` | on/off switch        | `default`                                                                             |
  | `choice`  | select               | `choices: [{ value, label }]`, `default`                                              |
  | `list`    | comma-separated text | `minItems`, `maxItems` (64), `pattern` and `patternMessage` per item                  |

A `secret` value is encrypted with `NEBULA_SECRETS_KEY` by the API before it reaches the
database and decrypted by the hub when the instance starts; the interface only ever learns that
one is kept. A `pattern` is a regular expression source and must compile, or the bundle fails to
load - which is the point: a typo here is found at startup rather than on somebody's form. Give
it a `patternMessage` whenever the pattern encodes a fact about the device: the form shows that
sentence under the field, where the pattern itself would tell a person nothing.

**Test** in the interface opens the bundle's transport once with what was typed and closes it
again, keeping nothing: for MQTT that is one session, for HTTP one request to the address. The
verdict is a sentence in the transport's own words, so `Not authorized` and `ECONNREFUSED` send
an owner to different places.

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

| `sdk.`            | What                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| `version`         | the runtime version, the one `manifest.sdk` was matched against            |
| `z`               | the runtime's zod, so the transport's settings validate as the hub's do    |
| `defineTransport` | the contract the platform's own transports are written against             |
| `openWebSocket`   | a WebSocket the hub keeps open: reconnection with a doubling pause, resets |
| `logger`          | the hub's logger, for what happens outside a connection                    |

The transport it returns is the one the platform's `http` and `mqtt` are:
`connectionKey`, `connect`, `scan`, `probe`, and a `configSchema` for what the driver's
`setup.json` asks. Its `id` must be `<vendor>/<name>`, or the loader refuses the vendor naming
both. It is **code**, so the vendor sits at the tier a code driver does - reviewed before a
catalogue carries it; `verifyVendor` is where the hub asks. The hub type-checks the ones that
ship here (`checkJs`), so write the types in JSDoc and start the file with `// @ts-check`.

## shelly

Fifteen drivers, one per layout of components, for the Shelly **Gen3 and Gen4** range: relays,
plugs, dimmers, covers, energy meters and input boxes, each driver listing the models it drives.
All of them run on the bundle's own transport, `shelly/rpc`: Shelly's JSON-RPC over the WebSocket
every device serves, with the status pushed as it changes and the digest authentication the
devices ask for. A driver claims a device by its hardware `model` code, one of a list.

Its own README says what the devices are, how the transport treats them, which models each
family takes, and what has not been checked against hardware - above all the model codes, and
the one-line fix when a device on the network is not claimed.

## bambu-lab

One driver, `printer`, listing X1C, X1E, P1S, P1P, A1 and A1 mini: every one of them is a Bambu
Lab printer in LAN mode, over the MQTT broker the printer runs itself, and the profile is the
same for all six - the list is there so the owner says which they have. The chamber light,
the temperatures and the print in progress; no camera. It is the first bundle on the MQTT
transport, and the four things it needed - a self-signed certificate, the serial that lives in
the topic, topics composed from it, and a request sent on every reconnect - are in the transport
now for whatever comes next. Its own README says what the printer is and what has not been
checked against one.
