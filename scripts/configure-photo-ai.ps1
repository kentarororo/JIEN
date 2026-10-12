[CmdletBinding()]
param(
  [string]$ProjectRef = 'vrgkkcunbngjgqfmlcuh',
  [ValidateSet('gemini', 'anthropic')][string]$Provider = 'gemini',
  [string]$Model = '',
  [string]$AnthropicWorkspaceId = '',
  [ValidateSet('personal-first', 'app')][string]$CredentialMode = 'personal-first',
  [switch]$UseExistingKey
)

$ErrorActionPreference = 'Stop'
if (-not $Model) {
  $Model = if ($Provider -eq 'anthropic') { 'claude-haiku-5-5' } else { 'gemini-3.5-flash-lite' }
}

if ($ProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw 'ProjectRef must be a 20-character Supabase project reference.'
}
if ($Model -notmatch '^[A-Za-z0-9._-]{1,128}$') {
  throw 'Model contains unsupported characters.'
}
if ($AnthropicWorkspaceId -and ($Provider -ne 'anthropic' -or $AnthropicWorkspaceId -notmatch '^wrkspc_[A-Za-z0-9]{1,128}$')) {
  throw 'AnthropicWorkspaceId requires the Anthropic provider and a wrkspc_ workspace ID.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $repoRoot

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  $bundledNodeDir = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
  $bundledNode = Join-Path $bundledNodeDir 'node.exe'
  if (-not (Test-Path -LiteralPath $bundledNode)) {
    throw 'Node.js was not found. Reopen this repository in Codex, or install Node.js LTS, then run this script again.'
  }
  $env:Path = "$bundledNodeDir;$env:Path"
}

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if ($pnpmCommand) {
  $pnpmPath = $pnpmCommand.Source
} else {
  $pnpmPath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
  if (-not (Test-Path -LiteralPath $pnpmPath)) {
    throw 'pnpm was not found. Reopen this repository in Codex, or install pnpm, then run this script again.'
  }
}

Write-Host ''
Write-Host 'JIEN server AI setup' -ForegroundColor Cyan
Write-Host "Project: $ProjectRef"
Write-Host "Model:   $Model"
Write-Host "Provider: $Provider; credential mode: $CredentialMode"
Write-Host 'App mode funds AI for every authenticated, consenting user with the server key.'
Write-Host 'Set a provider workspace budget and disable automatic credit reload if you want a fixed balance.'

$keyPointer = [IntPtr]::Zero
if (-not $UseExistingKey) {
  $secureKey = Read-Host "$Provider API key (hidden; never paste into chat)" -AsSecureString
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
}
$plainKey = $null
$tempSecretFile = Join-Path ([IO.Path]::GetTempPath()) ("jien-photo-ai-{0}.env" -f [Guid]::NewGuid().ToString('N'))

try {
  if (-not $UseExistingKey) {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    if ($plainKey -notmatch '^[A-Za-z0-9_-]{20,512}$') {
      throw 'The API key contains unsupported characters. Copy only the key and try again.'
    }
  }

  $providerPrefix = $Provider.ToUpperInvariant()
  $secretLines = @(
    "PHOTO_AI_PROVIDER=$Provider"
    "WELLNESS_AI_PROVIDER=$Provider"
    "AI_CREDENTIAL_MODE=$CredentialMode"
    "${providerPrefix}_MODEL=$Model"
  )
  if (-not $UseExistingKey) { $secretLines += "${providerPrefix}_API_KEY=$plainKey" }
  if ($AnthropicWorkspaceId) { $secretLines += "ANTHROPIC_WORKSPACE_ID=$AnthropicWorkspaceId" }
  $secretFileContents = $secretLines -join [Environment]::NewLine
  [IO.File]::WriteAllText($tempSecretFile, $secretFileContents, [Text.UTF8Encoding]::new($false))

  Write-Host ''
  Write-Host 'Saving server-only secrets...' -ForegroundColor Cyan
  & $pnpmPath dlx supabase@latest secrets set --env-file $tempSecretFile --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'Supabase could not save the photo-analysis secrets.' }

  Write-Host ''
  Write-Host 'Deploying the current AI functions...' -ForegroundColor Cyan
  foreach ($functionName in @('ai-settings', 'analyze-food-photo', 'wellness-chat')) {
    & $pnpmPath dlx supabase@latest functions deploy $functionName --project-ref $ProjectRef --use-api
    if ($LASTEXITCODE -ne 0) { throw "Supabase could not deploy $functionName." }
  }

  Write-Host ''
  Write-Host 'Configured secret names:' -ForegroundColor Cyan
  & $pnpmPath dlx supabase@latest secrets list --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'The function deployed, but Supabase could not list the configured secret names.' }

  Write-Host ''
  Write-Host 'Server configuration and AI functions deployed. Deploy the web app, then verify Settings and a photo scan.' -ForegroundColor Green
  Write-Host 'Configuration does not prove provider connectivity. No paid test was made by this script.'
} finally {
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
  $plainKey = $null
  $secretLines = $null
  $secretFileContents = $null
  if (Test-Path -LiteralPath $tempSecretFile) {
    Remove-Item -LiteralPath $tempSecretFile -Force
  }
}
