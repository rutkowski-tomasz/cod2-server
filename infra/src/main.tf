terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "1.50.0"
    }
  }
}

provider "hcloud" {
  token = var.hetzner_cloud_token
}

resource "hcloud_firewall" "firewall" {
  name = "${var.server_name}-firewall"

  # SSH access
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTP for reverse proxy
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS for reverse proxy
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # MariaDB access
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "3307"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # CoD2 server ports - TCP
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "28960-28999"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # CoD2 server ports - UDP
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "28960-28999"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "server" {
  name         = var.server_name
  image        = "docker-ce"
  server_type  = var.server_type
  location     = var.server_location
  ssh_keys     = []
  firewall_ids = [hcloud_firewall.firewall.id]

  user_data = templatefile("${path.module}/user-data.tftpl", {
    ubuntu_user_ssh_public_key          = var.ubuntu_user_ssh_public_key
    cod2_binaries_aws_access_key_id     = var.cod2_binaries_aws_access_key_id
    cod2_binaries_aws_secret_access_key = var.cod2_binaries_aws_secret_access_key
    cod2_binaries_aws_s3_bucket_name    = var.cod2_binaries_aws_s3_bucket_name
    cod2_binaries_aws_s3_bucket_region  = var.cod2_binaries_aws_s3_bucket_region
  })
}

output "server_ip" {
  value = hcloud_server.server.ipv4_address
}
