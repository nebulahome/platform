# govee

Govee lights with **LAN Control** switched on, over their LAN API. Once LAN Control is on - in
the Govee app, in the light's settings - nothing goes through the Govee cloud, unless the owner
gives the bundle their Govee account to hear changes sooner (below).

## What the light is

A light with LAN Control on speaks JSON datagrams over UDP, `{ "msg": { "cmd": …, "data": … } }`,
on three ports:

| Port | Who listens | What                                                                  |
| ---- | ----------- | --------------------------------------------------------------------- |
| 4001 | the light   | a `scan`, sent to the multicast group 239.255.255.250 or to one light |
| 4002 | the hub     | every answer, from every light, whatever it was asked                 |
| 4003 | the light   | `devStatus`, and the commands `turn`, `brightness`, `colorwc`         |

There is no authentication and no session, and the light pushes nothing: it answers what it is
asked and says nothing about a change made from the app, its remote or its button.

## The transport

`govee/lan`, shipped in the bundle (`lan/transport.js`), on the SDK's UDP sockets. Every answer
comes back to port 4002, so the vendor holds one socket there (`lan/socket.js`), shared by every
light's connection and by the discovery listener; each keeps the answers that are its own. A poll
asks a light `devStatus` on port 4003, every 5 s unless the owner picks otherwise. Three things are
translated on the way: the light speaks colour temperature in kelvin and the platform in mireds,
colour as red, green and blue and the platform as hue and saturation (brightness being the
light's own setting), and on and off as 1 and 0.

**How soon a change shows.** A command is followed by two status requests, 150 ms and 900 ms
after it, so what it changed shows at once rather than at the next poll. A status unlike the
last one - somebody is changing the light - has the light asked every second for ten seconds.
A change made elsewhere shows within one poll, then follows closely.

## Hearing changes at once: the Govee cloud (optional)

The only thing that tells of a change as it happens is Govee's own cloud: the Govee app listens
to an MQTT session with Amazon's IoT service, with a client certificate Govee's servers hand it
after sign-in. `lan/cloud.js` does the same, the way govee2mqtt does - it is **not a documented
API**, needs the internet, and Govee may change it. It is off unless the owner fills in the
vendor's settings (`setup.json`): the Govee account's email and password, the password kept
sealed.

- One session per account, shared by every light of it, held while any light is.
- Only listened to: commands still go over the LAN. What the cloud says a light shows goes through
  the same reading as a status the light answered.
- A light is matched to the cloud's messages by its id, which its scan answer gives.
- Signed in again before the token runs out; after a failure, again after 30 s, doubling to 30
  minutes, with one warning each time and no credential in it. The LAN polling carries on.

## The driver

One driver, `light-lan`, listing the models documented as LAN-capable. One entity, a `light` with
on/off, brightness (1 to 100), colour (hue and saturation) and colour temperature (2000 K to
9000 K, 111 to 500 mireds). Every LAN-capable model is an RGB light, so every one gets colour. A
light in colour mode reports its colour and no temperature; one in white mode the other way round.

## Found on the network

Govee lights do not announce themselves over mDNS; they answer a scan. The vendor's own listener
(`lan/discovery.js`) sends the scan to the multicast group when it starts and every five minutes,
and reports every light that answers with its address, its id (`device`) and its model (`sku`).
`modelCodes` maps each listed SKU onto itself, so a light is proposed as its model; a light whose
SKU is not listed is not proposed, and can still be added by address.

## What is not here, and why

- **Scenes and segments**: not part of the LAN API.
- **The cloud API**, for lights without LAN Control: a different vendor path, with an API key and
  capabilities that depend on the model.

## What is and is not checked against hardware

The bundle's test runs the transport and the listener against a light in the test process that
answers on the real ports, shaped after Govee's LAN API guide. It has not been run against a real
light. The SKU list is the first thing to extend: Govee adds LAN Control to more models than the
driver lists.
