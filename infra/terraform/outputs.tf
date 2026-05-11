output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "application_insights_connection_string" {
  value     = azurerm_application_insights.main.connection_string
  sensitive = true
}

output "static_site_default_host_name" {
  value = azurerm_static_site.dashboard.default_host_name
}
