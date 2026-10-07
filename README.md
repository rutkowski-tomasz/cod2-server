# cod2-server

Everything needed to run a Call of Duty 2 server:

- [`libcod/`](libcod) — our additions to [zk_libcod](https://github.com/ibuddieat/zk_libcod), see [functions](libcod/FUNCTIONS.md)
- [`docker/`](docker) — server image `ghcr.io/rutkowski-tomasz/cod2-server-1.3`
- [`infra/`](infra) — Terraform for the VPS and its services

Licensed under [MIT](LICENSE), except `docker/`, which keeps its original [Apache-2.0](docker/LICENSE) license.
