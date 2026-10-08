variable "hetzner_cloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ubuntu_user_ssh_public_key" {
  description = "SSH public key content"
  type        = string
}

variable "server_name" {
  description = "Name of the Hetzner server"
  type        = string
  default     = "cod2-server"
}

variable "server_type" {
  description = "Hetzner server type"
  type        = string
  default     = "cx22" # 2 vCPU, 4GB RAM, 40GB SSD
}

variable "server_location" {
  description = "Hetzner server location"
  type        = string
  default     = "nbg1" # Nuremberg, Germany
}

variable "cod2_binaries_git_url" {
  description = "HTTPS URL of the git repository (Git LFS) with CoD2 binaries, including a read token for a private repository"
  type        = string
  default     = ""
  sensitive   = true
}
