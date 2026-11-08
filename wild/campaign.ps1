# The real-network campaign: blocks of rounds spread over a day and a night (by default five
# blocks six hours apart), each running src/real/run-wild.ts over this machine's Wi-Fi and a phone
# tethered by USB. A block is LargeRounds rounds of every size in $Sizes, then more rounds of the
# smallest alone: small files are noisier and cost little of the phone's data. Before each block it
# finds both networks' addresses again (the phone's changes if it reconnects) and waits up to 30
# minutes for them. It reads the phone adapter's own counter, which includes anything else the
# computer sends over the phone, and starts no block once that passes PhoneBudgetGB. Keeps the
# computer from sleeping while it runs (not the lid: leave it open).
# Rows go to results/wild/wild.csv; a rerun skips what is there. Log: results/wild/campaign.log.
#
# Usage: powershell -ExecutionPolicy Bypass -File wild/campaign.ps1 -Server <IP> -Prefix <random path> [-FirstBlock 1] ...
param(
  [int]$Blocks = 5,
  [int]$FirstBlock = 1,
  [int]$LargeRounds = 5,
  [int]$ExtraSmallRounds = 3,
  [double]$HoursApart = 6,
  [string]$Sizes = '20,100',
  [string]$Algos = 'cats8,cats6,cats5,plexo,rb-eq,twoway-eq,mph2-eq',
  [double]$CapGB = 10,
  [double]$PhoneBudgetGB = 11,
  # When the first block starts, for resuming a schedule; now if empty.
  [string]$StartAt = '',
  [string]$Out = 'results/wild/wild.csv',
  [Parameter(Mandatory)][string]$Server,
  [Parameter(Mandatory)][string]$Prefix
)
Set-Location (Split-Path $PSScriptRoot -Parent)
$log = 'results/wild/campaign.log'
New-Item -ItemType Directory -Force results/wild | Out-Null
function Say($text) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text"; Write-Host $line; Add-Content $log $line }

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED: no sleep while this process runs.
Add-Type -Namespace Win -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
[Win.Power]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null

function Address($test) {
  $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and (& $test $_) } | Select-Object -First 1
  if (-not $adapter) { return $null }
  (Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress
}

# Bytes through the phone since this script started, plus what its adapter had counted by then.
# The counter restarts if the phone reconnects, so count from the last reading.
$script:phoneTotal = 0.0
$script:phoneLast = 0.0
function Track {
  $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*Remote NDIS*' -and $_.Status -eq 'Up' } | Select-Object -First 1
  if (-not $adapter) { return }
  $stats = $adapter | Get-NetAdapterStatistics
  $now = [double]$stats.ReceivedBytes + [double]$stats.SentBytes
  if ($now -ge $script:phoneLast) { $script:phoneTotal += $now - $script:phoneLast } else { $script:phoneTotal += $now }
  $script:phoneLast = $now
}
function PhoneGB { Track; [math]::Round($script:phoneTotal / 1e9, 2) }

$start = if ($StartAt) { [datetime]$StartAt } else { Get-Date }
$perBlock = $LargeRounds + $ExtraSmallRounds
$smallest = ($Sizes -split ',')[0]
Say "campaign: blocks $FirstBlock-$Blocks, $LargeRounds rounds of $Sizes and $ExtraSmallRounds of $smallest each, $HoursApart h apart, $Algos, cap $CapGB GB; phone so far $(PhoneGB) GB"
for ($b = $FirstBlock; $b -le $Blocks; $b++) {
  $at = $start.AddHours(($b - $FirstBlock) * $HoursApart)
  if ((Get-Date) -lt $at) { Say "block $b waits until $($at.ToString('MM-dd HH:mm'))" }
  while ((Get-Date) -lt $at) { Start-Sleep -Seconds 30; Track }
  if ((PhoneGB) -ge $PhoneBudgetGB) { Say "block ${b}: not started, phone at $(PhoneGB) GB of $PhoneBudgetGB GB"; continue }

  # A network can drop mid-block: run-wild then stops with an error, and a rerun skips finished rows.
  $first = ($b - 1) * $perBlock + 1
  for ($try = 1; $try -le 6; $try++) {
    $deadline = (Get-Date).AddMinutes(30)
    do {
      $wifi = Address { param($a) $a.Name -eq 'Wi-Fi' }
      $lte = Address { param($a) $a.InterfaceDescription -like '*Remote NDIS*' }
      if ($wifi -and $lte) { break }
      Start-Sleep -Seconds 30
    } while ((Get-Date) -lt $deadline)
    if (-not ($wifi -and $lte)) { Say "block ${b}: skipped, networks not up (wifi '$wifi', phone '$lte')"; break }

    Say "block ${b}: rounds $first-$($first + $perBlock - 1), try $try, wifi $wifi, phone $lte"
    $failed = $false
    foreach ($part in @(@($Sizes, $LargeRounds, $first), @($smallest, $ExtraSmallRounds, ($first + $LargeRounds)))) {
      node --experimental-strip-types --no-warnings src/real/run-wild.ts $Out $Server $Prefix $part[0] $part[1] $Algos "wifi=$wifi" "lte=$lte" $CapGB $part[2] 2>&1 |
        ForEach-Object { Say "  $_" }
      if ($LASTEXITCODE -ne 0) { $failed = $true; break }
    }
    if (-not $failed) { Say "block ${b}: done; phone so far $(PhoneGB) GB"; break }
    Say "block ${b}: stopped with an error"
    Start-Sleep -Seconds 60
  }
}
# So the report exists even if nobody is there to run it.
if ($Out -eq 'results/wild/wild.csv' -and (Test-Path $Out)) {
  python -W ignore analysis/wild.py $perBlock 2>&1 | Out-Null
  Say "analysis exit code $LASTEXITCODE"
}
Say "campaign done; phone $(PhoneGB) GB"
[Win.Power]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null
