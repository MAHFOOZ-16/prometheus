variable "project_name" {
  description = "Project prefix used for Azure resource names."
  type        = string
  default     = "prometheus"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "staging"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "westeurope"
}
