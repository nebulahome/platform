# sonoff

Sonoff relays in **DIY mode**, over the HTTP API the firmware serves on your own network. Nothing
goes through the eWeLink cloud, and nothing stops working when the internet does.

## What the device is

DIY mode is a firmware feature of the relays ITEAD lists as DIY-capable: switched on - from the
eWeLink app on recent firmware, by holding the button on older ones - the device stops talking to
the cloud and serves a small HTTP API on port **8081** instead. Every request is a **POST** with a
JSON body, `{ "deviceid": "", "data": { … } }`; a GET at the same path is not answered.

| Path               | Body `data`          | What it does                                       |
| ------------------ | -------------------- | -------------------------------------------------- |
| `/zeroconf/info`   | `{}`                 | answers the relay's state, its id and its firmware |
| `/zeroconf/switch` | `{ "switch": "on" }` | switches it (`"off"` to switch it off)             |

## The driver

One driver, `diy-plug`, for the single-relay DIY devices - BASICR3, RFR3, MINI, MINIR2 - on the
platform's `http` transport. It polls `/zeroconf/info` every five seconds and switches with
`/zeroconf/switch`. One entity: the relay, a `switch`.

## Found on the network

A DIY device announces itself over mDNS as `_ewelink._tcp`, with a TXT record carrying its `id`
and its `type` - `diy_plug` for these four. That is enough to propose it without asking it
anything, so `discovery.json` has no probe: the `type` names the driver through `modelCodes`, but
not which of the four it is, and adopting one asks the owner to pick. The `id` in the TXT record is
the `deviceid` the device then answers with, which is what identification insists on.

## What is not here, and why

- **The MINIR3, the D1 dimmer, the B02/B05 bulbs and the SPM meter** answer DIY with other `type`s
  and other payloads - several relays, a brightness - and are each a driver of their own when they
  come.
- **eWeLink LAN mode without DIY** encrypts its payloads with a key only the cloud hands out; it
  is not this API.
- **Firmware that answers `data` as a JSON string** rather than an object - some before 3.5 - is
  not read: the paths find nothing, and the device stays `identifying`.

## What is and is not checked against hardware

The bundle's test drives it against a device in the test process shaped after the DIY API as ITEAD
documents it. It has not been run against a real relay: the thing to check first is that the TXT
`id` and the `deviceid` in `/zeroconf/info` agree, as the documentation says they do.
