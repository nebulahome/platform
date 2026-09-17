# bambu-lab

A Bambu Lab printer in **LAN mode** - the "developer mode" toggle in the printer's network
settings - over the MQTT broker the printer runs itself. The chamber light, the nozzle, bed and
chamber temperatures, and the print in progress. No camera: that is a different protocol on a
different port, and a different bundle when it comes.

## What the printer is

Unlike a Shelly, which is reached by address over HTTP, a Bambu printer **is a broker**. It listens
on port 8883, behind TLS with a certificate it signed itself, and lets in exactly one user:

| Setting  | Value                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| URL      | `mqtts://<printer address>:8883`                                                           |
| Username | `bblp`, always                                                                             |
| Password | the **access code** - eight characters, on the printer's screen under the network settings |

The printer publishes its state on `device/<serial>/report` and takes requests on
`device/<serial>/request`. The serial is the one on the box and on the printer's screen; the
bundle never needs to be told it, because it reads it off the topic the printer speaks on.

## Setting it up

One device of this bundle per printer. In the interface, **Integrations → Bambu Lab → Add
device** asks which model it is, what to call it, and the two things only the owner knows - the
printer's address and its access code - and **Test** opens one session to the printer before
anything is saved, so a
mistyped code is refused with `Connection refused: Not authorized` rather than discovered later
in a log. The address must be `mqtts://`: the printer has no plain-text listener, so
`mqtt://<address>:1883` is refused by the printer with `ECONNREFUSED` - the host answered, nothing
listens on that port - and the form refuses it first, saying why. The other two settings the
broker needs come from `setup.json` as constants and never appear in the form, so the row the hub
reads is:

```json
{
  "url": "mqtts://192.168.1.60:8883",
  "username": "bblp",
  "password": { "$sealed": "v1:…" },
  "shouldVerifyCertificate": false
}
```

The access code is sealed with `NEBULA_SECRETS_KEY` by the API and opened by the hub when the
instance starts; it is never served back.

`shouldVerifyCertificate: false` is not optional, which is why it is a constant. The printer
signs its own certificate and is reached by address, so there is nothing the certificate could be
checked against; with it on, the handshake is refused and the instance sits in `failed` with a
message about a self-signed certificate. What is given up is the guarantee that the thing at that
address is the printer; what is kept is that the traffic is encrypted. On a home network that is
the right trade, and the constant records that it was made.

Once saved, the hub starts the instance at once and the device shows `identifying`: the hub
listens on `device/+/report` and claims whatever reports a `print` block, by the serial in its
topic, then asks `core` to complete the device's row with that serial and the printer's
entities. From then on the bundle subscribes to that printer's report topic and asks it for a
full status - see below for why that matters - and the readings are on the device's row,
changing as the printer reports. The claim stays on the row, so a restarted hub watches the
printer again on its own without listening for it twice.

**A P1 or an A1 can sit in `identifying` for a while.** Those printers report on change and when
asked, and the hub cannot ask before it knows the serial, which is the thing it is listening
for. Touching a setting on the printer's screen, or turning its light on, gives the hub
something to hear; the hub listens again as soon as a pass ends empty, so nothing has to be
restarted. An X1 reports on its own every few seconds and is identified within them. The serial
is on the box and on the printer's screen; the entity ids are composed from the device's id
(`sensor.bambu_lab_x1c_nozzle_temperature`), not from the serial, so a replaced printer keeps
its automations.

## Entities

| Entity                      | Domain          | From                                                   |
| --------------------------- | --------------- | ------------------------------------------------------ |
| Chamber light               | `light`         | `lights_report[0].mode`, on and off                    |
| Nozzle temperature / target | `sensor` °C     | `nozzle_temper`, `nozzle_target_temper`                |
| Bed temperature / target    | `sensor` °C     | `bed_temper`, `bed_target_temper`                      |
| Chamber temperature         | `sensor` °C     | `chamber_temper`                                       |
| Printing                    | `binary_sensor` | `gcode_state` is `RUNNING`                             |
| Print progress              | `sensor` %      | `mc_percent`                                           |
| Remaining time              | `sensor` min    | `mc_remaining_time`                                    |
| Layer / total layers        | `sensor`        | `layer_num`, `total_layer_num`                         |
| Speed level                 | `sensor`        | `spd_lvl` - 1 silent, 2 standard, 3 sport, 4 ludicrous |

A printer without a chamber sensor - an A1, a P1P - simply never reports one, and the entity
stays empty rather than wrong.

The light can be turned on and off. It cannot be **toggled**: the firmware has no toggle command
and a profile cannot compute one from the last state. Asking for a toggle is refused with a
message saying so, which is better than a profile that silently sent "on".

## What a profile cannot say, and why

**Full reports and deltas.** An X1 pushes its whole status every second. A P1 or an A1 pushes only
what changed, and only after being asked once for everything - which is what the `pushall` in
the subscriptions is for. It is sent every time the session comes up and every five minutes
after, so a missed delta is a five-minute gap rather than a permanent one. Between those, a delta
naming only the nozzle changes only the nozzle: the mapper reads absence as absence, and a light
that was not mentioned stays exactly as it was.

**The light is index zero.** `lights_report` is a list, and the profile grammar can index a list
but cannot search one. On every model this bundle names, `chamber_light` is the first entry - an
X1 lists a `work_light` after it. If a printer ever lists them the other way round, the light
here will be the wrong one, and `[0]` in `profile.json` is the thing to change.

**Fans and signal strength are not here.** The printer reports fan speeds as strings (`"15"`),
its Wi-Fi as `"-47dBm"`, and a numeric sensor wants a number. Converting one into the other is
computation, which is the line a profile does not cross; a code bundle can, when somebody wants
them badly enough.

**Nor are pause, resume and stop.** There is no capability for "a print job" in the canonical
model yet, and a switch pretending to be one would be a lie the interface repeats.

## What is and is not checked against hardware

There is no printer on the test bench. The bundle is tested against a simulated one on the
development broker - it answers `pushall` and `ledctrl` the way the firmware is documented to -
and against the payloads the community has recorded from real printers.

**The TLS handshake is settled.** `shouldVerifyCertificate: false` is passed straight through to
the client as `rejectUnauthorized: false`, and a real printer on a home network took the handshake
and answered the connect packet - `Not authorized` to a deliberately wrong code, which is the
broker speaking, past TLS. A certificate error from an instance would therefore be news, and the
message will name what the client objected to.

**So is the identification.** The same printer answered the wildcard subscription the hub
listens on, `device/+/report`, within seconds of being asked, was identified from the interface
without a hand on it, and reported every entity above except the chamber temperature - which a
P1S does not have, as the entities table says. If a device stays `identifying` while a printer is
on and in LAN mode, the printer is idle and quiet: a P1 or an A1 reports on change, so touching a
setting on its screen, or turning its light on, gives the hub something to hear.
