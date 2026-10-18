param(
  [string]$Source = ".env.example",
  [string]$Destination = ".env"
)

if (Test-Path $Destination) {
  Write-Host "$Destination already exists. Skipping."
  exit 0
}

Copy-Item $Source $Destination
Write-Host "Created $Destination from $Source"
