`localhost-cert.pem` and `localhost-key.pem` are a self-signed certificate for
`localhost` / `127.0.0.1`, used only by unit tests (https through socks proxies).
they are not secret and aren't trusted anywhere else. regenerate with:

```
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout localhost-key.pem -out localhost-cert.pem -days 36500 \
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
