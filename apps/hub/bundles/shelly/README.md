# shelly

Shelly **Gen3 and Gen4** devices on the local network, spoken to over the RPC interface every
one of them serves on a WebSocket at `ws://<address>/rpc`. Relays, plugs, dimmers, covers, energy
meters and input boxes - fifteen drivers, one per layout of components, each listing the models
it drives. Nothing goes through Shelly's cloud, and nothing stops working when the internet does.

## What the device is

A Gen2+ Shelly is a small JSON-RPC server. A request is a frame - `{ "id", "src", "method",
"params" }` - and the device answers with the same id. Once it has seen one request naming a
source, it also **pushes** a `NotifyStatus` frame whenever something changes: a relay switched
from the wall, a dimmer turned, a cover arriving at its limit. That push is why this bundle does
not poll: a row moves the moment the light does.

Everything the device is doing is one object, `Shelly.GetStatus`, keyed by component -
`switch:0`, `light:0`, `cover:0`, `em1:0`, `input:2`. A notification carries only what changed,
under the same keys. The profiles read the status by those keys, quoted because a colon is not a
bare name in the path grammar: `'light:0'.brightness`.

The device says what it is through `Shelly.GetDeviceInfo`, which answers even with a password
set:

```
curl http://<address>/rpc/Shelly.GetDeviceInfo
```

```json
{
  "id": "shelly0110dimg3-8cbfea9c4a2c",
  "model": "S3DM-0010WW",
  "gen": 3,
  "ver": "1.5.0",
  "app": "Dimmer0110VPMG3",
  "auth_en": false
}
```

`id` is what makes the device the same device next time. `model` is the hardware code - the
one printed on the box and the label - and it is what the drivers claim by. `app` is the
firmware's name for itself; it has changed between releases, so nothing here depends on it.

## The transport

The WebSocket is not a platform transport: the hub has `http` and `mqtt`, and neither speaks
Shelly's RPC. So the bundle ships its own, `rpc/transport.js`, named in `manifest.json` and
registered by the hub as **`shelly/rpc`** when the vendor loads. It is plain JavaScript written
against the same contract as the hub's own transports, handed the runtime's pieces - zod,
`defineTransport`, a managed WebSocket that reconnects by itself - so it imports nothing from
the platform and the bundle installs on any hub whose runtime matches `sdk`.

What it does, in the order a device meets it:

- **Test**, in the add-device form, opens one socket, asks `Shelly.GetDeviceInfo` and closes
  again. With a password typed it also asks for the status, so a wrong password fails there and
  not after saving. A device with authentication on and no password typed fails with
  `asks for a password`.
- **Identification** asks the same question and hands the answer to the drivers; the one whose
  claim holds takes the device.
- **Running**, the socket stays open. The transport asks for the whole status when the socket
  opens and once a minute after - which also keeps the socket busy enough to notice a device
  that went - and lays every notification over the last status it has, attribute by attribute,
  before handing the whole object on. A profile never sees a partial report, so a cover told
  only that it is `opening` keeps its position.
- **Commands** are `call` requests: `Switch.Set`, `Light.Set` with a `brightness`,
  `Cover.GoToPosition`. A request not answered in five seconds drops the socket, which reconnects.

**Authentication** is Shelly's digest, SHA-256, with the user always `admin`: a request refused
with a `401` is sent again with the answer to the challenge, and the nonce is kept for the
requests after it, its count moving on each time. A stale nonce is replaced once; a second
refusal is `refused the password`. The count goes as a number and into the hash in decimal,
which is how Home Assistant's client speaks to every firmware, the ones before 2.0 included.

## The families

| Driver        | Models                                                                    | Entities                                                    |
| ------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `switch`      | 1, 1L, 1 Mini - Gen3 and Gen4                                             | relay, device temperature                                   |
| `switch-pm`   | 1PM, 1PM Mini - Gen3 and Gen4                                             | relay, power, energy, voltage, current, device temperature  |
| `plug`        | Plug S Gen3, Outdoor Plug S Gen3, AZ Plug, Plug M Gen3, Plug US Gen4      | as `switch-pm`                                              |
| `switch-2`    | 2L Gen3, 2L Gen4                                                          | two relays, device temperature                              |
| `switch-2pm`  | 2PM Gen3, 2PM Gen4, in the **switch** profile                             | two relays with their readings, device temperature          |
| `cover-pm`    | 2PM Gen3, 2PM Gen4, in the **cover** profile                              | cover (position, open, close, stop, go to), its readings    |
| `shutter`     | Shutter                                                                   | as `cover-pm`                                               |
| `power-strip` | PowerStrip Gen4 (two hardware revisions), PowerStrip US Gen4              | four relays with power and energy each                      |
| `pm`          | PM Mini Gen3, Plug PM Gen3                                                | power, voltage, current, frequency, energy, energy returned |
| `em-1`        | EM Mini Gen4                                                              | as `pm`, with the power factor                              |
| `em-2`        | EM Gen3, EM Gen4                                                          | the dry contact, and the `em-1` readings for each channel   |
| `3em`         | 3EM-63 Gen3, in the **triphase** profile                                  | power, voltage and current per phase, totals, energies      |
| `dimmer`      | DALI Dimmer Gen3                                                          | light (on, off, brightness), device temperature             |
| `dimmer-pm`   | Dimmer 0/1-10V PM Gen3 and Gen4, Dimmer Gen3, Dimmer Gen4, Dimmer Gen4 US | light, power, energy, voltage, current, device temperature  |
| `inputs`      | I4 Gen3, I4 Gen4                                                          | four inputs, as binary sensors                              |

A driver claims a device when its `model` is one of the codes in the driver's list - the codes
come from Home Assistant's list of Shelly hardware, one per model the form offers, in the same
order. A 2PM is two devices in one box: which driver claims it depends on the profile it is in,
`switch` or `cover`, so the form offers it twice, as `2PM Gen3 (relays)` and `2PM Gen3 (cover)`.
A device whose profile is changed in its web page stops being claimed by the driver it was
added with; it is removed and added again with the other.

Setting a dimmer's level switches it on at that level: a level is what the lamp shows, and a lamp
that is off shows none.

## What is not here, and why

**Readings some devices only have when wired for them.** The Dimmer Gen3 and Gen4 measure power
only with a neutral wire; without one their power, energy, voltage and current entities stay
empty. A cover reports its position only once calibrated from its web page, and `Cover.GoToPosition`
needs the calibration too; an uncalibrated cover says nothing at all rather than a motion without
a position.

**Inputs in button mode.** An I4 input set up as a button reports presses as events, which are
not state; its `state` is null and its entity stays empty. As a switch, it reports on and off.

**Battery devices.** The H&T Gen3, the Flood and the Flood S sleep, and wake only to push a status
to a server they are configured to reach - an outbound WebSocket, which is a server in the hub and
a piece of work of its own.

**Bulbs, and the Presence sensor.** A Duo Bulb's white is in Kelvin and a colour bulb's colour
in red, green and blue; the canonical model speaks mireds and hue and saturation, and converting
one into the other is computation, which a profile does not do. The Presence Gen4's components
are not documented yet.

**The rest of the range.** The BLU gateways and everything Bluetooth, the Camera, The Pill, the
X MOD1 and Cury are not relays or meters, and each would be a family of its own.

**Gen1 and Gen2.** Gen2 (Plus, Pro) speaks the same RPC and could join these families, with
their own model codes; Gen1 is a different API altogether.

## What is and is not checked against hardware

Nothing here has been run against a device yet. The frames, the digest and the notification
overlay follow Shelly's API documentation and Home Assistant's client, and the transport is tested
against a device simulated from the documented frames; the profiles are tested against statuses
shaped after the documentation's own examples.

**The model codes are the fact most worth checking.** If a device on the network stays
`identifying`, the hub logs what it heard - the address and what the device said of itself,
`model` included. A code missing from a family's `oneOf` in its `profile.json` is the whole fix:
add it there, and its label to `models` in `driver.json`, in the same position.
