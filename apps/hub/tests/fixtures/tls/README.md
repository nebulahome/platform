# A self-signed certificate for tests

`localhost.crt.pem` and `localhost.key.pem` are a throwaway certificate for `127.0.0.1` and
`localhost`, signed by nobody, for the managed socket's TLS test
(`src/transports/managed-socket.test.ts`): a `wss://` server it is refused by default and accepted
with `tls: { rejectUnauthorized: false }`. Nothing trusts it and nothing else uses it. Made with:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj /CN=localhost \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" \
  -keyout localhost.key.pem -out localhost.crt.pem
```
