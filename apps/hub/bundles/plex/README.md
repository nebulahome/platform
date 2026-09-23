# plex

A Plex Media Server on your own network, read from the server itself: how many streams it is
playing right now.

## What the server is

Plex Media Server listens on port **32400**. It says who it is without asking anything -
`GET /identity` answers its `machineIdentifier` and its version - and answers everything else only
to a request carrying the owner's **token** in the `X-Plex-Token` header. The token is not a
password: it is issued per account, and Plex's own help explains where to read it (open any item
in Plex Web, Get Info, View XML, and copy the value after `X-Plex-Token=` in the address).

## The driver

One driver, `server`, on the platform's `http` transport. Its `setup.json` asks for the address
and the token, and fixes `tokenHeader: X-Plex-Token` as a constant: the transport sends the token
in that header on every request, and it never appears in an address or in a log. One entity, the
**Activity** sensor, is `MediaContainer.size` of `GET /status/sessions`, polled every fifteen
seconds: the number of streams playing.

## Not found on the network

Plex announces itself with GDM, a protocol of its own on UDP 32414, not over mDNS; there is no
`discovery.json`, and a server is added by its address.

## What is not here, and why

- **A player per stream**, appearing and disappearing as people press play: the number of
  entities would depend on the payload, which is a code driver, not a profile.
- **A sensor per library**: the same reason.
- **Signing in with a Plex account** to be handed a token: a flow the setup form does not have.

## What is and is not checked against hardware

The bundle's test runs it against a server in the test process that answers `/identity` openly and
everything else only with the token, shaped after Plex's API documentation. It has not been run
against a real server.
