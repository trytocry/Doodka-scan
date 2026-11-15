$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -Path (Join-Path $PSScriptRoot 'printer-driver.cs')
  $result = [PrinterDriver]::Run([string]$request.printer, [string]$request.action, [int]$request.stockId, [long]$request.owner)
  # Seagull's legacy paper width includes an extra printable offset. Its
  # PrintTicket reports the label size displayed in the native driver UI.
  Add-Type -AssemblyName System.Printing
  $server = New-Object System.Printing.LocalPrintServer
  $queue = $null
  try {
    $queue = $server.GetPrintQueue([string]$request.printer)
    function Read-XmlStream($stream) {
      $reader = New-Object System.IO.StreamReader($stream)
      try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    function Property-Value($node, $name) {
      $prop = $node.SelectSingleNode("*[substring-after(@name, ':')='$name']/*[local-name()='Value']")
      if ($prop) { return $prop.InnerText }
      return $null
    }
    $caps = Read-XmlStream ($queue.GetPrintCapabilitiesAsXml())
    foreach ($option in $caps.SelectNodes("//*[local-name()='Feature' and substring-after(@name, ':')='PageMediaSize']/*[local-name()='Option']")) {
      $id = Property-Value $option 'StockID'
      $width = Property-Value $option 'MediaSizeWidth'
      $height = Property-Value $option 'MediaSizeHeight'
      if ($null -ne $id -and $null -ne $width -and $null -ne $height) {
        foreach ($stock in $result.stocks) {
          if ($stock.id -eq [int]$id) { $stock.width = [double]$width / 1000; $stock.height = [double]$height / 1000 }
        }
      }
    }
    $ticket = $queue.UserPrintTicket
    if ($null -eq $ticket) { $ticket = $queue.DefaultPrintTicket }
    $xmlTicket = Read-XmlStream ($ticket.GetXmlStream())
    $option = $xmlTicket.SelectSingleNode("//*[local-name()='Feature' and substring-after(@name, ':')='PageMediaSize']/*[local-name()='Option']")
    if ($option) {
      $width = Property-Value $option 'MediaSizeWidth'; $height = Property-Value $option 'MediaSizeHeight'
      if ($null -ne $width -and $null -ne $height) { $result.width = [double]$width / 1000; $result.height = [double]$height / 1000 }
    }
  } finally { if ($queue) { $queue.Dispose() }; $server.Dispose() }
  @{ ok = $true; data = $result } | ConvertTo-Json -Depth 6 -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
