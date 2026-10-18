# Gera assets.js (imagens em base64) e icon.svg a partir da pasta imagens/.
# Rode novamente sempre que trocar alguma imagem:  pwsh ./build-assets.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$tmp = Join-Path $env:TEMP 'mondilene-b64.txt'

$files = [ordered]@{
  walk      = 'Mondilene-walk.png'
  start     = 'tela_inicial.jpg'
  bg        = 'fujioka.png'
  cortador  = 'cortador.png'
  escova    = 'escova_rotativa.png'
  secador   = 'secador.png'
  secadorJu = 'secador_ju.png'
  bomb      = 'bomb.png'
}

function Get-DataUri($path) {
  $sig = [int[]](Get-Content $path -AsByteStream -TotalCount 4)
  $mime = if ($sig[0] -eq 0x52 -and $sig[1] -eq 0x49) { 'image/webp' }
          elseif ($sig[0] -eq 0xFF) { 'image/jpeg' }
          else { 'image/png' }
  # 0x40000001 = base64 sem cabeçalho e sem quebras de linha
  certutil -f -encodehex $path $tmp 0x40000001 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "certutil falhou para $path" }
  $b64 = (Get-Content $tmp -Raw) -replace '\s', ''
  "data:$mime;base64,$b64"
}

$lines = @('// Gerado por build-assets.ps1 - nao editar manualmente.', 'window.ASSETS = {')
$uris = @{}
foreach ($key in $files.Keys) {
  $uris[$key] = Get-DataUri (Join-Path $root "imagens/$($files[$key])")
  $lines += "  ${key}: '$($uris[$key])',"
}
$lines += '};'
$uris.portrait = Get-DataUri (Join-Path $root 'imagens/Mondilene.png')  # só para o ícone
Set-Content -Path (Join-Path $root 'assets.js') -Value ($lines -join "`n") -Encoding utf8NoBOM

$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#e2363e"/>
  <clipPath id="c"><rect x="86" y="40" width="340" height="432" rx="60"/></clipPath>
  <image clip-path="url(#c)" x="86" y="40" width="340" height="432" preserveAspectRatio="xMidYMid slice" href="$($uris.portrait)" xlink:href="$($uris.portrait)"/>
</svg>
"@
Set-Content -Path (Join-Path $root 'icon.svg') -Value $svg -Encoding utf8NoBOM

Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Host "assets.js e icon.svg gerados."
