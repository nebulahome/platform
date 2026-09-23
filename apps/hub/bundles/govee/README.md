# govee

Govee lights with **LAN Control** switched on, over their LAN API. Once LAN Control is on - in
the Govee app, in the light's settings - nothing goes through the Govee cloud.

## What the light is

A light with LAN Control on speaks JSON datagrams over UDP, `{ "msg": { "cmd": …, "data": … } }`,
on three ports:

| Port | Who listens | What                                                                  |
| ---- | ----------- | --------------------------------------------------------------------- |
| 4001 | the light   | a `scan`, sent to the multicast group 239.255.255.250 or to one light |
| 4002 | the hub     | every answer, from every light, whatever it was asked                 |
| 4003 | the light   | `devStatus`, and the commands `turn`, `brightness`, `colorwc`         |

There is no authentication and no session.

## The transport

`govee/lan`, shipped in the bundle (`lan/transport.js`), on the SDK's UDP sockets. Every answer
comes back to port 4002, so the vendor holds one socket there (`lan/socket.js`), shared by every
light's connection and by the discovery listener; each keeps the answers that are its own. A poll
asks a light `devStatus` on port 4003. Two things are translated on the way: the light speaks
colour temperature in kelvin and the platform in mireds, and it reports on and off as 1 and 0.

## The driver

One driver, `light-lan`, listing the models documented as LAN-capable. One entity, a `light` with
on/off, brightness (1 to 100) and colour temperature (2000 K to 9000 K, 111 to 500 mireds).

## Found on the network

Govee lights do not announce themselves over mDNS; they answer a scan. The vendor's own listener
(`lan/discovery.js`) sends the scan to the multicast group when it starts and every five minutes,
and reports every light that answers with its address, its id (`device`) and its model (`sku`).
`modelCodes` maps each listed SKU onto itself, so a light is proposed as its model; a light whose
SKU is not listed is not proposed, and can still be added by address.

## What is not here, and why

- **Colour (RGB)**: the platform's colour capability is hue and saturation, and the conversion is
  a computation, not a mapping; a follow-up in the transport.
- **Scenes and segments**: not part of the LAN API.
- **The cloud API**, for lights without LAN Control: a different vendor path, with an API key and
  capabilities that depend on the model.

## What is and is not checked against hardware

The bundle's test runs the transport and the listener against a light in the test process that
answers on the real ports, shaped after Govee's LAN API guide. It has not been run against a real
light. The SKU list is the first thing to extend: Govee adds LAN Control to more models than the
driver lists.
