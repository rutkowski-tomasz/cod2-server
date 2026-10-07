# 🌎 cod2-as-code
CoD2 in minutes

Setting up Call of Duty 2 server requires a lot of configuration and can be a pain. Use this repo to automate process of provisioning and configuring. It utilizes terraform and does everything for you. The CoD2 server will be launched inside docker. The docker image used is maintained here: [cod2-docker](https://github.com/rutkowski-tomasz/cod2-docker).

Thanks a lot to whole [killtube.org](https://killtube.org/) community for open-source developing. 🥰

# 🚀 Features

1. Provision VPS with required dependencies
2. Configure robust firewall
3. Deploy Docker Engine with Swarm mode
4. Set up networking for master-server registration
5. Create standardized directory structure
6. Install CoD2 binaries (v1.0, 1.2, 1.3)
7. Implement secure reverse-proxy
8. Automate Let's Encrypt certificate management
9. Configure CoD2 FastDL via reverse-proxy
10. Deploy MariaDB server
11. Integrate phpMyAdmin
12. Set up automated S3 database backups
13. Configure Discord crash log reporting

# 📝 Pre-requirements

- terraform CLI
- AWS account (`aws_access_key_id` + `aws_secret_access_key` with S3 reader permission) 
- CoD2 server files uploaded to S3, bucket should look like this:

```
S3 bucket
├── 1_0
│   ├── iw_00.iwd
│   ├── iw_01.iwd
│   ├── iw_02.iwd
│   ├── (...)
│   ├── iw_13.iwd
│   ├── iw_14.iwd
│   └── localized_english_iw99.iwd
└── 1_3
    └── iw_15.iwd
```

`localized_english_iw99.iwd` comes from this [IzNoGoD's post](https://killtube.org/showthread.php?2873-CoD2-Install-CoD2-on-your-VDS-much-faster!&p=16261&viewfull=1#post16261)

# 🤷🏻‍♂️ How to use?

To get the reverse-proxy (fastdl and phpmyadmin) working remember to configure DNS A record for subdomains `fastdl.yourdomain.com` and `pma.yourdomain.com`.

```sh
ssh-keygen -t ed25519 -f ~/.ssh/mykey -N "" # Generate key
cp src/terraform.tfvars.example src/terraform.tfvars # Copy example vars
code src/terraform.tfvars # Edit vars
terraform apply
```

After its done you can dispatch GitHub Actions workflow to start services.

# 🌲 What's the structure after installation

```
├── cod2
│   ├── library
│   │   ├── 000empty.iwd
│   │   ├── build-000empty.sh
│   │   ├── iwds
│   │   ├── iwds_sum
│   │   └── scripts
│   ├── main
│   │   ├── 1_0
│   │   │   ├── iw_00.iwd
│   │   │   ├── iw_01.iwd
│   │   │   ├── iw_02.iwd
│   │   │   ├── (...)
│   │   │   ├── iw_13.iwd
│   │   │   ├── iw_14.iwd
│   │   │   └── localized_english_iw99.iwd
│   │   └── 1_3
│   │       ├── iw_00.iwd
│   │       ├── iw_01.iwd
│   │       ├── iw_02.iwd
│   │       ├── (...)
│   │       ├── iw_14.iwd
│   │       ├── iw_15.iwd
│   │       └── localized_english_iw99.iwd
│   └── servers
│       └── my-server - example: https://github.com/nl-squad/nl-cod2-zom-iwds
│           ├── compose.yml
│           └── fs_game
│               ├── maps
│               │   └── mp
│               │       └── gametypes
│               │           └── tdm.gsc
│               ├── mod.iwd
│               └── server.cfg
└── reverse-proxy
    ├── certs
    └── www
```

# 📀 Manually snapshot db and restore

```sh
/opt/homebrew/opt/mysql-client/bin/mysqldump --skip-column-statistics \
--databases nl cod2_zom \
-h "51.68.142.183" -P "3307" -u "root" -p"pass" > databases_backup.sql

pv databases_backup.sql | /opt/homebrew/opt/mysql-client/bin/mysql \
-h "116.203.79.194" -P "3307" -u "root" -p"pass"
```