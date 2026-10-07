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

variable "cod2_binaries_aws_access_key_id" {
  description = "AWS access key ID for S3 bucket with CoD2 binaries"
  type        = string
  default     = ""
}

variable "cod2_binaries_aws_secret_access_key" {
  description = "AWS secret access key for S3 bucket with CoD2 binaries"
  type        = string
  default     = ""
  sensitive   = true
}

variable "cod2_binaries_aws_s3_bucket_name" {
  description = "S3 bucket name for CoD2 binaries (without 's3://' prefix)"
  type        = string
  default     = ""
}

variable "cod2_binaries_aws_s3_bucket_region" {
  description = "S3 bucket region for CoD2 binaries"
  type        = string
  default     = "eu-central-1"
}
