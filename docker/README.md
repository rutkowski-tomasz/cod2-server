# 🚢 docker

Docker image for your Call of Duty 2 server. Libcod included!

All the tags can be found [here](https://github.com/users/rutkowski-tomasz/packages/container/package/cod2-server-1.3).

# 🚀 Features

This image was created because it seems that [cod2docker](https://github.com/Lonsofore/cod2docker) is not longer maintained. Also it includes following advancements:

- integrating with [zk_libcod](https://github.com/ibuddieat/zk_libcod) at the commit pinned in `libcod/UPSTREAM`, plus [our additions](../libcod)
- speex integration for dynamic sound loading
- github workflow builds and publishes images on push
- running container as non-root user
- making mounted main and library folders read-only
- update to latest ubuntu & packages version
- other minor optimizations: removing not used packages

# 🤷🏻‍♂️ How to use?

Upload your main folder and fs_game of server to the machine running docker. Create `docker-compose.yml` from the template below.

```yml
# Remember to adjust the parameters to your needs
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
      - ~/cod2/Library:/cod2/library:ro
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

# 🏠 Development

Any contribution is welcome. See [AGENTS.md](../AGENTS.md) for the local build command.

# 📦 New version

A push to `master` that changes `libcod/` or `docker/` builds and publishes a new image and creates a git tag. The version is derived from git tags using conventional commits (major bump on breaking changes, otherwise minor).
