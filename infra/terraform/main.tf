locals {
  normalized_name = lower(replace("${var.project_name}-${var.environment}", "_", "-"))
  compact_name    = substr(replace(local.normalized_name, "-", ""), 0, 18)
  tags = {
    project     = var.project_name
    environment = var.environment
    owner       = "portfolio"
  }
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.normalized_name}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.normalized_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${local.normalized_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = local.tags
}

resource "azurerm_storage_account" "main" {
  name                     = "st${local.compact_name}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = local.tags
}

resource "azurerm_eventhub_namespace" "main" {
  name                = "evhns-${local.normalized_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Standard"
  capacity            = 1
  tags                = local.tags
}

resource "azurerm_eventhub" "incidents" {
  name                = "incident-events"
  namespace_name      = azurerm_eventhub_namespace.main.name
  resource_group_name = azurerm_resource_group.main.name
  partition_count     = 2
  message_retention   = 1
}

resource "azurerm_key_vault" "main" {
  name                       = "kv-${local.compact_name}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
  tags                       = local.tags
}

data "azurerm_client_config" "current" {}

resource "azurerm_static_web_app" "dashboard" {
  name                = "swa-${local.normalized_name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = local.tags
}

resource "azurerm_api_management" "main" {
  name                = "apim-${local.normalized_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  publisher_name      = "Prometheus Platform"
  publisher_email     = "platform@example.com"
  sku_name            = "Developer_1"
  tags                = local.tags
}

# ── Azure Integration Services ──

resource "azurerm_servicebus_namespace" "main" {
  name                = "sbns-${local.normalized_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Standard"
  tags                = local.tags
}

resource "azurerm_servicebus_queue" "incidents" {
  name         = "incident-events"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count = 10
  lock_duration      = "PT1M"
}

resource "azurerm_servicebus_queue" "normalization" {
  name         = "normalization-requests"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count = 5
  lock_duration      = "PT30S"
}

resource "azurerm_logic_app_workflow" "normalizer" {
  name                = "logic-normalizer-${local.normalized_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_logic_app_workflow" "incident_agent" {
  name                = "logic-incident-agent-${local.normalized_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_logic_app_integration_account" "main" {
  name                = "ia-${local.normalized_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku_name            = "Basic"
  tags                = local.tags
}
