# Caddy with a DNS provider module, so it can get a Let's Encrypt certificate
# through the DNS-01 challenge: the certificate is proven by a DNS record, so
# nothing has to be reachable from the internet. See docs/deployment.md.
#
# Cloudflare by default. For another DNS provider, set DNS_MODULE to its
# caddy-dns module (https://github.com/caddy-dns), and change the `dns` line in
# the Caddyfile and the token variable in compose.prod.yml to match: see
# "Another DNS provider" in docs/deployment.md.

# Pinned; bump both together.
ARG CADDY_VERSION=2.11.4

FROM caddy:${CADDY_VERSION}-builder AS builder
ARG DNS_MODULE=github.com/caddy-dns/cloudflare@v0.2.4
RUN xcaddy build --with ${DNS_MODULE}

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
