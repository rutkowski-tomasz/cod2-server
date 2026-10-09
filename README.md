# cod2-server

Everything needed to run a Call of Duty 2 server:

- [`server/`](server) — server image `ghcr.io/rutkowski-tomasz/cod2-server-1.3` and our additions to [zk_libcod](https://github.com/ibuddieat/zk_libcod), see [functions](server/FUNCTIONS.md)
- [`infra/`](infra) — Terraform for the VPS
- [`stacks/`](stacks) — Docker Swarm stacks running on the VPS, deployed by the `deploy-<stack>` workflows
- [`tools/fxview/`](tools/fxview) — plays `.efx` effects outside the game, for people and for agents checking their own effects
- [`tools/menuview/`](tools/menuview) — draws `.menu` files outside the game, for people and for agents checking their own menus

See [AGENTS.md](AGENTS.md) for the local build command and how libcod is built.

## Docker image

All tags are [here](https://github.com/users/rutkowski-tomasz/packages/container/package/cod2-server-1.3). The image started as a replacement for the unmaintained [cod2docker](https://github.com/Lonsofore/cod2docker). It adds:

- [zk_libcod](https://github.com/ibuddieat/zk_libcod) at the commit pinned in `server/UPSTREAM`, plus [our additions](server/extra)
- optional speex for dynamic sound loading (`--build-arg enable_speex=true`; off in published images)
- a non-root user and read-only main and library folders
- Ubuntu 24.04 without unused packages

Upload your main folder and the server's fs_game to the Docker host, then create `docker-compose.yml` from this template:

```yml
version: '3.7'
services:
  my-server:
    image: ghcr.io/rutkowski-tomasz/cod2-server-1.3:latest
    container_name: my-server
    user: "1001:1002" # you can skip, this is set by default
    restart: always
    stdin_open: true
    tty: true
    ports:
      - 28970:28970
      - 28970:28970/udp
    volumes:
      - ./my-server:/cod2/my-server:ro
      - ~/cod2/main/1_3:/cod2/main:ro
      - ~/cod2/library:/cod2/library:ro
    environment:
      PARAMS_BEFORE: "+exec server.cfg"
      COD2_SET_fs_homepath: "/cod2/home"
      COD2_SET_fs_library: "library"
      COD2_SET_fs_game: "my-server"
      COD2_SET_dedicated: 2
      COD2_SET_net_port: 28970
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "10"

networks:
  default:
    external:
      name: my_network
```

A push to `master` that changes `server/` builds and publishes a new image and creates a git tag. The version comes from git tags and Conventional Commits: a breaking change bumps the major version, anything else the minor.

## Infra

Terraform provisions a VPS with Docker Swarm for running CoD2 servers, with:

- a firewall and networking for master-server registration
- CoD2 binaries 1.0, 1.2 and 1.3
- an nginx reverse proxy with Let's Encrypt certificates, serving FastDL and phpMyAdmin
- MariaDB with automated S3 backups
- crash logs sent to Discord

### Prerequisites

- terraform CLI
- CoD2 server files in a Git LFS repository, and a token that can read it:

```
git repository
├── 1_0
│   ├── iw_00.iwd … iw_14.iwd
│   └── localized_english_iw99.iwd
└── 1_3
    └── iw_15.iwd
```

`localized_english_iw99.iwd` comes from [IzNoGoD's post](https://killtube.org/showthread.php?2873-CoD2-Install-CoD2-on-your-VDS-much-faster!&p=16261&viewfull=1#post16261).

### Setup

Point DNS A records for `fastdl.yourdomain.com` and `pma.yourdomain.com` at the server.

```sh
ssh-keygen -t ed25519 -f ~/.ssh/mykey -N ""
cd infra
cp terraform.tfvars.example terraform.tfvars # then edit it
terraform apply
```

Then dispatch each `deploy-<stack>` GitHub Actions workflow to start the stacks. They need:

- secrets `DEPLOY_KEY`, `DEPLOY_USER`, `DEPLOY_HOST`
- secrets `DB_ROOT_PASSWORD`, `DB_BACKUP_AWS_ACCESS_KEY`, `DB_BACKUP_AWS_SECRET_ACCESS_KEY`
- secrets `LETS_ENCRYPT_EMAIL`, `SHUTDOWN_LOGS_DISCORD_WEBHOOK`
- variable `LETS_ENCRYPT_DOMAINS`

Layout on the server after setup:

```
├── cod2
│   ├── library
│   ├── main
│   │   ├── 1_0
│   │   │   ├── iw_00.iwd … iw_14.iwd
│   │   │   └── localized_english_iw99.iwd
│   │   ├── 1_2 (copy of 1_0)
│   │   └── 1_3
│   │       ├── iw_00.iwd … iw_15.iwd
│   │       └── localized_english_iw99.iwd
│   └── servers
│       └── my-server - example: https://github.com/nl-squad/nl-cod2-zom-iwds
│           ├── compose.yml
│           └── fs_game
│               ├── maps/mp/gametypes/tdm.gsc
│               ├── mod.iwd
│               └── server.cfg
└── reverse-proxy
    ├── certs
    └── www
```

### Copy databases between servers

```sh
mysqldump --skip-column-statistics --databases nl cod2_zom \
  -h <source-host> -P 3307 -u root -p > databases_backup.sql

pv databases_backup.sql | mysql -h <target-host> -P 3307 -u root -p
```

## Credits and license

Thanks to the [killtube.org](https://killtube.org/) community for their open-source work.

Licensed under [MIT](LICENSE).
