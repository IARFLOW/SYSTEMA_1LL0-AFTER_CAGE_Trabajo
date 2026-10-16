# Systema 1LL0~ After Cage · las pantallas que van por cable a este ordenador con Windows
#
#   windows.cmd proyector1 proyector2
#       abre proyector1 y proyector2 en las pantallas de este ordenador, de izquierda a
#       derecha, a pantalla completa y sonando sin que nadie las toque. Se queda
#       vigilándolas en esta ventana, y con Ctrl+C se cierran
#   windows.cmd --instalar proyector1 proyector2
#       lo mismo, pero se queda puesto y se abren solas cada vez que se inicia sesión
#   windows.cmd --servidor 192.168.1.20 proyector1 proyector2
#       la dirección del servidor, la IP del Mac que lo lleva (hace falta siempre,
#       que en este ordenador no va)
#   windows.cmd --ver proyector1 proyector2
#       qué pantallas veo, en qué orden y qué abriría en cada una, sin abrir nada
#   windows.cmd --quitar
#       lo quita y cierra las ventanas
#
#   --con-integrada   usa también la pantalla del propio portátil, que si no se
#                     queda libre
#
# Es lo mismo que mac.sh, para el portátil de Guille. Cada pantalla va en su
# propio Chrome, con su perfil aparte, en modo quiosco y con
# --autoplay-policy=no-user-gesture-required, que es lo que la deja sonar sin un
# toque. El orden es el de Configuración > Sistema > Pantalla, de izquierda a
# derecha. Si una ventana se cierra, se va a otra pantalla o su página deja de
# estar conectada al servidor, la vuelvo a abrir. Si una pantalla se apaga o se
# desenchufa, cierro su ventana para que no se vaya a otra, y la abro otra vez
# en cuanto vuelve. Mientras está en marcha, Windows no se duerme ni apaga las
# pantallas.
#
# Lo que cuenta va también a %LOCALAPPDATA%\Systema\pantallas\pantallas.log.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 2.0
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# En Windows PowerShell 5.1 no existe $IsWindows, y ahí siempre es Windows. Las
# pruebas lo corren en el Mac con PowerShell 7.
$EsWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows

# Las pruebas cambian la carpeta, el Chrome y los tiempos con estas variables.
if ($env:SYSTEMA_PANTALLAS) { $Base = $env:SYSTEMA_PANTALLAS } else { $Base = Join-Path $env:LOCALAPPDATA 'Systema\pantallas' }
$Perfiles = Join-Path $Base 'perfiles'
$Estado = Join-Path $Base 'estado'
$Log = Join-Path $Base 'pantallas.log'
$Espera = 5
if ($env:SYSTEMA_ESPERA) { $Espera = [double]::Parse($env:SYSTEMA_ESPERA, [Globalization.CultureInfo]::InvariantCulture) }
$Reabrir = 10   # como mucho una vez cada tantos segundos por ventana
if ($env:SYSTEMA_REABRIR) { $Reabrir = [int]$env:SYSTEMA_REABRIR }
$Gracia = 15    # lo que le dejo a una ventana recién abierta para colocarse
if ($env:SYSTEMA_GRACIA) { $Gracia = [int]$env:SYSTEMA_GRACIA }
$Pagina = 30    # lo que puede estar una página sin conectar antes de abrirla otra vez
if ($env:SYSTEMA_PAGINA) { $Pagina = [int]$env:SYSTEMA_PAGINA }
$Acceso = ''
if ($EsWindows) { $Acceso = Join-Path ([Environment]::GetFolderPath('Startup')) 'Systema pantallas.lnk' }

function Cuantas([int]$n) { if ($n -eq 1) { return '1 pantalla' } else { return "$n pantallas" } }

function Fallo([string]$texto) {
  [Console]::Error.WriteLine($texto)
  # Y al registro, que desde el acceso de Inicio no hay ventana donde leerlo.
  try { Add-Content -LiteralPath $Log -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto) -Encoding UTF8 } catch { }
  exit 1
}

$EnArchivo = $false   # vigilando, lo que cuento va también al registro
function Cuenta([string]$texto) {
  $linea = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  Write-Output $linea
  if ($script:EnArchivo) {
    try { Add-Content -LiteralPath $Log -Value $linea -Encoding UTF8 } catch { }
  }
}

# ---------- Las opciones ----------
$Modo = 'probar'
$Servidor = ''
$Integrada = $false
$Sueltos = @()
$todo = @($args)
for ($i = 0; $i -lt $todo.Count; $i++) {
  $a = [string]$todo[$i]
  if ($a -match '^--?instalar$') { $Modo = 'instalar' }
  elseif ($a -match '^--?quitar$') { $Modo = 'quitar' }
  elseif ($a -match '^--?ver$') { $Modo = 'ver' }
  elseif ($a -match '^--?vigilar$') { $Modo = 'vigilar' }   # es lo que lanza el acceso de inicio
  elseif ($a -match '^--?con-integrada$') { $Integrada = $true }
  elseif ($a -match '^--?servidor$') {
    if ($i + 1 -ge $todo.Count) { Fallo 'falta la dirección, por ejemplo --servidor 192.168.1.20' }
    $i++
    $Servidor = [string]$todo[$i]
  }
  elseif ($a -match '^--?(h|help|ayuda)$') {
    Get-Content -LiteralPath $PSCommandPath -Encoding UTF8 | Select-Object -First 18 | ForEach-Object { $_ -replace '^# ?', '' }
    exit 0
  }
  elseif ($a.StartsWith('-')) { Fallo "no conozco la opción $a" }
  else { $Sueltos += $a }
}

# ---------- Los nombres ----------
# En minúsculas, como los entiende el servidor, y cada uno como en el Max
# (/proyector1/video), con letras sin tilde, números, _ y -. Valen separados por
# espacios o por comas.
$Nombres = @()
foreach ($s in $Sueltos) {
  foreach ($n in ($s.ToLowerInvariant() -split '[\s,;]+')) {
    if (-not $n) { continue }
    if ($n -notmatch '^[a-z0-9_-]{1,32}$') {
      Fallo "«$n» no vale como nombre de pantalla. Solo letras sin tilde, números, _ y -, y el mismo que usa el Max (/proyector1/video)"
    }
    if ($Nombres -contains $n) { Fallo "«$n» sale dos veces, y cada pantalla tiene que tener su nombre" }
    $Nombres += $n
  }
}

# ---------- Lo que pido a Windows ----------
# Las pantallas, una a una (EnumDisplayMonitors, que no se queda con una lista
# vieja como System.Windows.Forms), con su posición en píxeles de verdad y el
# identificador del monitor, para reconocerla y saber cuál es la del portátil.
# Dónde está la ventana de cada Chrome, y llevarla a su sitio. Y que no se
# duerma. Va en C# 5, que es lo que compila Windows PowerShell 5.1.
$codigo = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class SystemaPantallas {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }

  public delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data);

  [DllImport("user32.dll")]
  static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern bool EnumDisplayDevices(string device, uint num, ref DISPLAY_DEVICE dd, uint flags);
  [DllImport("user32.dll")]
  static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")]
  static extern bool SetProcessDPIAware();
  [DllImport("kernel32.dll")]
  static extern uint SetThreadExecutionState(uint flags);

  // Que el sistema no se duerma ni apague las pantallas mientras siga este
  // proceso (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED).
  public static void Despierto() { SetThreadExecutionState(0x80000003); }

  // Píxeles de verdad en todas las pantallas, aunque cada una tenga su escala.
  public static void PixelesDeVerdad() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { }
    try { SetProcessDPIAware(); } catch (Exception) { }
  }

  // Una línea por pantalla. Si es la principal (1) o no (0), x, y, ancho, alto,
  // su nombre en Windows (\\.\DISPLAY1), el identificador del monitor y su modelo.
  public static string[] Lista() {
    List<string> salida = new List<string>();
    MonitorEnumProc cada = delegate (IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data) {
      MONITORINFOEX mi = new MONITORINFOEX();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      if (GetMonitorInfo(monitor, ref mi)) {
        DISPLAY_DEVICE dd = new DISPLAY_DEVICE();
        dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
        string id = "", modelo = "";
        if (EnumDisplayDevices(mi.szDevice, 0, ref dd, 1)) { id = dd.DeviceID; modelo = dd.DeviceString; }
        salida.Add(String.Join("\t", new string[] {
          (mi.dwFlags & 1) != 0 ? "1" : "0",
          mi.rcMonitor.Left.ToString(), mi.rcMonitor.Top.ToString(),
          (mi.rcMonitor.Right - mi.rcMonitor.Left).ToString(), (mi.rcMonitor.Bottom - mi.rcMonitor.Top).ToString(),
          mi.szDevice, id, modelo }));
      }
      return true;
    };
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cada, IntPtr.Zero);
    GC.KeepAlive(cada);
    return salida.ToArray();
  }

  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr data);

  [DllImport("user32.dll")]
  static extern bool EnumWindows(EnumWindowsProc proc, IntPtr data);
  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")]
  static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]
  static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")]
  static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

  // La ventana visible más grande de ese proceso, o IntPtr.Zero si no tiene.
  static IntPtr VentanaDe(int pid) {
    IntPtr mejor = IntPtr.Zero;
    long area = 0;
    EnumWindowsProc cada = delegate (IntPtr h, IntPtr data) {
      uint suyo;
      GetWindowThreadProcessId(h, out suyo);
      RECT r;
      if (suyo == (uint)pid && IsWindowVisible(h) && GetWindowRect(h, out r)) {
        long a = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
        if (a > area) { area = a; mejor = h; }
      }
      return true;
    };
    EnumWindows(cada, IntPtr.Zero);
    GC.KeepAlive(cada);
    return mejor;
  }

  // Dónde está la ventana de ese proceso (x, y, ancho, alto), o "" si no tiene.
  public static string Ventana(int pid) {
    IntPtr h = VentanaDe(pid);
    RECT r;
    if (h == IntPtr.Zero || !GetWindowRect(h, out r)) return "";
    return String.Join("\t", new string[] {
      r.Left.ToString(), r.Top.ToString(), (r.Right - r.Left).ToString(), (r.Bottom - r.Top).ToString() });
  }

  // La lleva a ese sitio sin traerla delante y sin esperar a que Chrome conteste
  // (SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS), que si Chrome se cuelga
  // no se cuelgue esto con él.
  public static bool Mover(int pid, int x, int y, int w, int h) {
    IntPtr v = VentanaDe(pid);
    return v != IntPtr.Zero && SetWindowPos(v, IntPtr.Zero, x, y, w, h, 0x0004 | 0x0010 | 0x4000);
  }
}
'@
if (-not ('SystemaPantallas' -as [type])) { Add-Type -TypeDefinition $codigo -Language CSharp }
# Antes de preguntar nada por las pantallas, que si no Windows da sus medidas
# repartidas por la escala.
if ($EsWindows) { [SystemaPantallas]::PixelesDeVerdad() }

# El mismo monitor sale escrito de dos maneras, y lo dejo igual en las dos.
#   \\?\DISPLAY#BOE0867#4&2a0b8e3e&0&UID8388688#{e6f07b5f-…}   (EnumDisplayDevices)
#   DISPLAY\BOE0867\4&2a0b8e3e&0&UID8388688_0                  (WMI)
function Clave([string]$s) {
  $s = $s -replace '^\\\\\?\\', '' -replace '#\{.*$', '' -replace '#', '\' -replace '_\d+$', ''
  return $s.ToUpperInvariant()
}

# Los monitores que van por dentro del portátil, según Windows (WMI). Si no lo
# puedo saber, $null, y tomo por la del portátil la pantalla principal. Si la
# consulta falla, lo vuelvo a intentar en la vuelta siguiente.
#   0x80000000 interna, 6 LVDS, 11 DisplayPort integrado, 13 UDI integrado
$script:Internas = $null
$script:ListaInternas = $null
function Internas([string]$firma) {
  if ($null -ne $script:Internas -and $script:ListaInternas -eq $firma) { return }
  $script:Internas = $null
  try {
    $conexiones = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorConnectionParams -ErrorAction Stop)
    $h = @{}
    foreach ($c in $conexiones) {
      $t = [uint32]$c.VideoOutputTechnology
      if ($t -eq 2147483648 -or $t -eq 6 -or $t -eq 11 -or $t -eq 13) { $h[(Clave ([string]$c.InstanceName))] = $true }
    }
    $script:Internas = $h
    $script:ListaInternas = $firma
  } catch { }
}

# Una por pantalla, ordenadas de izquierda a derecha (y a igual x, de arriba
# abajo), con si es la del portátil, dónde empieza, su tamaño y su id. El id es
# el del monitor en ese conector (el UID cambia de un conector a otro). Por las
# coordenadas no se la reconoce, porque al quitar una pantalla Windows recoloca
# las demás (la principal siempre empieza en 0,0).
function Pantallas {
  $lista = @()
  if ($env:SYSTEMA_PANTALLAS_FALSAS) {
    # Para las pruebas, como en mac.sh. Integrada (1) o no, x, y, ancho, alto, id, nombre.
    foreach ($l in @(Get-Content -LiteralPath $env:SYSTEMA_PANTALLAS_FALSAS -Encoding UTF8 -ErrorAction SilentlyContinue)) {
      $c = $l -split "`t"
      if ($c.Count -lt 6) { continue }
      $nombre = ''
      if ($c.Count -ge 7) { $nombre = $c[6] }
      $lista += [pscustomobject]@{ Integrada = ($c[0] -eq '1'); X = [int]$c[1]; Y = [int]$c[2]; W = [int]$c[3]; H = [int]$c[4]; Id = $c[5]; Nombre = $nombre }
    }
    $script:Metodo = 'pruebas'
  } else {
    $crudas = @([SystemaPantallas]::Lista())
    Internas ($crudas -join "`n")
    foreach ($l in $crudas) {
      $c = $l -split "`t"
      if ($null -ne $script:Internas) { $integrada = [bool]$script:Internas[(Clave $c[6])]; $script:Metodo = 'windows' }
      else { $integrada = ($c[0] -eq '1'); $script:Metodo = 'principal' }
      $id = Clave $c[6]
      if (-not $id) { $id = $c[5].ToUpperInvariant() }
      $nombre = $c[7]
      if (-not $nombre) { $nombre = $c[5] }
      $lista += [pscustomobject]@{ Integrada = $integrada; X = [int]$c[1]; Y = [int]$c[2]; W = [int]$c[3]; H = [int]$c[4]; Id = $id; Nombre = $nombre }
    }
  }
  return @($lista | Sort-Object X, Y)
}
$script:Metodo = ''

# ---------- Qué va en cada una ----------
# Como en mac.sh. La primera vez, o cuando alguien lo lanza a mano, el primer
# nombre va en la pantalla de más a la izquierda, el segundo en la siguiente, y
# así. La del portátil no cuenta, salvo con --con-integrada. En cuanto están
# todas, apunto en «colocacion» qué pantalla le tocó a cada nombre, por su id.
# Desde entonces cada nombre va a su pantalla, esté donde esté, y si la suya no
# está, espera, para que las demás no se corran un puesto. Pero si se ven tantas
# pantallas como nombres y alguno no encuentra la suya (el cable va a otro
# conector, o han cambiado la tele por otra), se queda con la que sobra y desde
# ahí es la suya. Dos pantallas con el mismo id se distinguen por su orden. Si
# no hay nada apuntado y faltan pantallas, las pongo en orden y lo digo.
# Sale un objeto por nombre (con su pantalla y su clave, o $null si espera), los
# que cambian de pantalla así y cómo se ha hecho.
function Planificar($pantallas, [string]$fichero) {
  $usables = @($pantallas | Where-Object { (-not $_.Integrada) -or $Integrada })
  $iguales = @{}
  $claves = @(foreach ($p in $usables) { $iguales[$p.Id] = 1 + [int]$iguales[$p.Id]; '{0}#{1}' -f $p.Id, $iguales[$p.Id] })
  $memoria = @{}
  if ($fichero -and (Test-Path -LiteralPath $fichero)) {
    foreach ($l in @(Get-Content -LiteralPath $fichero)) {
      $c = $l -split "`t"
      if ($c.Count -ge 2 -and $Nombres -contains $c[0]) { $memoria[$c[0]] = $c[1] }
    }
  }
  $asignada = @{}
  $nuevas = @()
  if ($memoria.Count -eq 0) {
    if ($usables.Count -ge $Nombres.Count) { $modo = 'todas' } else { $modo = 'en_orden' }
    for ($i = 0; $i -lt $Nombres.Count -and $i -lt $usables.Count; $i++) { $asignada[$Nombres[$i]] = $i }
  } else {
    $usadas = @{}
    foreach ($n in $Nombres) {
      if (-not $memoria.ContainsKey($n)) { continue }
      for ($d = 0; $d -lt $usables.Count; $d++) {
        if (-not $usadas.ContainsKey($d) -and $claves[$d] -eq $memoria[$n]) { $asignada[$n] = $d; $usadas[$d] = $true; break }
      }
    }
    # Un nombre que no estaba la última vez va a la primera que sobre.
    $d = 0
    foreach ($n in $Nombres) {
      if ($memoria.ContainsKey($n)) { continue }
      while ($d -lt $usables.Count -and $usadas.ContainsKey($d)) { $d++ }
      if ($d -lt $usables.Count) { $asignada[$n] = $d; $usadas[$d] = $true }
    }
    # Y con tantas pantallas como nombres, el que no encuentra la suya se queda
    # con la que sobre.
    if ($usables.Count -ge $Nombres.Count) {
      $d = 0
      foreach ($n in $Nombres) {
        if ($asignada.ContainsKey($n)) { continue }
        while ($d -lt $usables.Count -and $usadas.ContainsKey($d)) { $d++ }
        if ($d -lt $usables.Count) { $asignada[$n] = $d; $usadas[$d] = $true; $nuevas += $n }
      }
    }
    if ($asignada.Count -eq $Nombres.Count) { $modo = 'todas' } else { $modo = 'memoria' }
  }
  $filas = @(foreach ($n in $Nombres) {
    $p = $null; $clave = $null
    if ($asignada.ContainsKey($n)) { $p = $usables[$asignada[$n]]; $clave = $claves[$asignada[$n]] }
    [pscustomobject]@{ Nombre = $n; Pantalla = $p; Clave = $clave }
  })
  return [pscustomobject]@{ Filas = $filas; Nuevas = $nuevas; Modo = $modo; Vistas = $usables.Count }
}

function Firma($plan) {
  return (@($plan.Filas | ForEach-Object {
    if ($null -eq $_.Pantalla) { '{0}=-' -f $_.Nombre }
    else { '{0}={1} {2} {3} {4} {5}' -f $_.Nombre, $_.Clave, $_.Pantalla.X, $_.Pantalla.Y, $_.Pantalla.W, $_.Pantalla.H }
  }) -join ';')
}

# ---------- Cada ventana ----------
# Lo de cada pantalla va en ficheros de $Estado, como en mac.sh. nombre.pid su
# Chrome, .donde la clave de su pantalla, .desde cuándo se abrió, .sin que
# espera a su pantalla, .intentos y .casi lo que llevo sin conseguir dejarla
# bien, .rendida que me he rendido y la he cerrado, y .desconectada desde
# cuándo su página no está conectada al servidor.
function Ruta([string]$n, [string]$que) { return Join-Path $Estado "$n.$que" }
function Leer([string]$fichero) {
  if (-not (Test-Path -LiteralPath $fichero)) { return '' }
  return ([string](Get-Content -LiteralPath $fichero -Raw)).Trim()
}
function Escribir([string]$fichero, [string]$texto) { Set-Content -LiteralPath $fichero -Value $texto -Encoding ASCII }
function Hay([string]$n, [string]$que) { return Test-Path -LiteralPath (Ruta $n $que) }
function Marca([string]$n, [string]$que) { Escribir (Ruta $n $que) '' }
function Quita([string]$n, [string[]]$que) { foreach ($q in $que) { Remove-Item -LiteralPath (Ruta $n $q) -ErrorAction SilentlyContinue } }
function Ahora { return [int64]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) }
function Edad([string]$n, [string]$que) {
  $t = [int64]0
  [void][int64]::TryParse((Leer (Ruta $n $que)), [ref]$t)
  return (Ahora) - $t
}

# Los procesos con ese perfil abierto. En Windows sale la línea de órdenes de
# cada uno, y ahí va --user-data-dir con la carpeta del perfil.
function Patron([string]$n) { return [regex]::Escape((Join-Path $Perfiles $n)) + '"?( |$)' }
function Procesos([string]$n) {
  $patron = Patron $n
  if ($EsWindows) {
    return @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -match $patron) } | ForEach-Object { [int]$_.ProcessId })
  }
  return @(& /bin/ps -ax -ww -o pid= -o command= | Where-Object { $_ -match $patron } | ForEach-Object { [int](($_.Trim() -split '\s+')[0]) })
}

function Viva([string]$n) {
  $id = 0
  if (-not [int]::TryParse((Leer (Ruta $n 'pid')), [ref]$id)) { return $false }
  # Que siga ahí y que sea el Chrome de esa pantalla, no otro programa que haya
  # heredado el número.
  if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { return $false }
  return (Procesos $n) -contains $id
}

function Matar([int]$id, [bool]$fuerte) {
  if ($EsWindows) {
    # taskkill sin /F le pide a Chrome que se cierre como si le dieran a la X.
    if ($fuerte) { & cmd.exe /c "taskkill /F /T /PID $id >nul 2>&1" } else { & cmd.exe /c "taskkill /PID $id >nul 2>&1" }
  } else {
    if ($fuerte) { & /bin/kill -KILL $id 2>$null } else { & /bin/kill -TERM $id 2>$null }
  }
}

function Cerrar([string]$n) {
  # El número apuntado solo si sigue siendo su Chrome. Tras un apagón o un
  # reinicio puede ser ya de otro programa, y a ese ni tocarlo.
  $i = 4
  if (Viva $n) { Matar ([int](Leer (Ruta $n 'pid'))) $false; $i = 0 }
  # Y lo que quede de ese perfil, de una vez anterior o de un Chrome colgado. Con
  # otro Chrome abierto con ese perfil, el nuevo le pasaría la dirección y se
  # cerraría al momento.
  while ($true) {
    $restos = @(Procesos $n)
    if ($restos.Count -eq 0) { break }
    if ($i -eq 4) { foreach ($r in $restos) { Matar $r $false } }
    if ($i -ge 20) { foreach ($r in $restos) { Matar $r $true }; break }
    $i++
    Start-Sleep -Milliseconds 250
  }
  Quita $n 'pid', 'donde'
}

# Igual que en mac.sh, salvo dónde se pone la ventana. Chrome en Windows mide en
# sus propias unidades, que con la escala de Windows (125 %, 150 %…) no son los
# píxeles de verdad. La pongo pequeña y en el centro de su pantalla, que es lo
# que menos se mueve de una cuenta a otra, y el modo quiosco la pone a pantalla
# completa en la pantalla donde esté. Si aun así cae en otra, ComprobarVentanas
# la lleva a la suya.
function Abrir([string]$n, $f) {
  $p = $f.Pantalla
  Cerrar $n
  $perfil = Join-Path $Perfiles $n
  New-Item -ItemType Directory -Force -Path $perfil | Out-Null
  $cx = [int]($p.X + $p.W / 2)
  $cy = [int]($p.Y + $p.H / 2)
  $argumentos = @(
    "--user-data-dir=`"$perfil`"",
    '--kiosk', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check',
    '--noerrdialogs', '--hide-crash-restore-bubble',
    '--disable-features=Translate',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    ('--window-position={0},{1}' -f ($cx - 200), ($cy - 150)), '--window-size=400,300',
    "$Servidor/screen/$n")
  $proceso = Start-Process -FilePath $Chrome -ArgumentList $argumentos -PassThru
  Escribir (Ruta $n 'pid') ([string]$proceso.Id)
  Escribir (Ruta $n 'donde') $f.Clave
  Escribir (Ruta $n 'desde') ([string](Ahora))
  Quita $n 'sin', 'casi', 'desconectada'
}

# Lo que se ha quedado sin su pantalla, o va a ir a otra, se cierra en cuanto se
# ve, haya servidor o no. Si no, Windows se llevaría la ventana a otra pantalla
# y taparía la otra tele hasta la vuelta siguiente.
function Retirar($plan) {
  foreach ($f in $plan.Filas) {
    $n = $f.Nombre
    if (-not (Hay $n 'donde')) { continue }
    $clave = '-'
    if ($null -ne $f.Pantalla) { $clave = $f.Clave }
    if ((Leer (Ruta $n 'donde')) -eq $clave) { continue }
    Cerrar $n
    if ($null -eq $f.Pantalla) {
      Marca $n 'sin'
      Cuenta "cierro $n, que su pantalla ya no está, y la abro en cuanto vuelva"
    } else {
      Cuenta "cierro $n, que le toca otra pantalla"
    }
  }
}

function Colocar($plan) {
  foreach ($n in $plan.Nuevas) { Cuenta "$n no encuentra su pantalla y sobra otra, así que la pongo ahí y desde ahora es la suya" }
  foreach ($f in $plan.Filas) {
    $n = $f.Nombre
    # Con las pantallas cambiadas, la que me había rendido tiene otra oportunidad.
    Quita $n 'rendida', 'intentos'
    if ($null -eq $f.Pantalla) {
      if (-not (Hay $n 'sin')) { Cuenta "$n se queda sin abrir hasta que aparezca su pantalla" }
      Marca $n 'sin'
      if (Hay $n 'donde') { Cerrar $n }
    } elseif ((Leer (Ruta $n 'donde')) -ne $f.Clave -or -not (Viva $n)) {
      Abrir $n $f
      Cuenta ('abro {0} en la pantalla de {1}×{2} que empieza en {3},{4}' -f $n, $f.Pantalla.W, $f.Pantalla.H, $f.Pantalla.X, $f.Pantalla.Y)
    }
  }
  if ($plan.Modo -eq 'todas') {
    $lineas = @($plan.Filas | Where-Object { $null -ne $_.Pantalla } | ForEach-Object { '{0}{1}{2}' -f $_.Nombre, "`t", $_.Clave })
    Set-Content -LiteralPath (Join-Path $Estado 'colocacion') -Value $lineas -Encoding ASCII
  } elseif ($plan.Modo -eq 'en_orden') {
    Cuenta ('ojo, veo {0} para {1} nombres, y no sé cuál falta, así que las pongo en orden. En cuanto estén todas, cada una vuelve a su sitio' -f (Cuantas $plan.Vistas), $Nombres.Count)
  }
}

# Dónde está la ventana de ese proceso (x, y, ancho, alto separados por
# tabuladores), - si no tiene ninguna que se vea, y ? si no lo sé.
function VentanaDe([int]$id) {
  if ($env:SYSTEMA_PANTALLAS_FALSAS) {
    if (-not $env:SYSTEMA_VENTANAS_FALSAS) { return '?' }
    foreach ($l in @(Get-Content -LiteralPath $env:SYSTEMA_VENTANAS_FALSAS -ErrorAction SilentlyContinue)) {
      $c = $l -split "`t"
      if ($c.Count -ge 2 -and $c[0] -eq [string]$id) {
        if ($c[1] -eq '-') { return '-' }
        if ($c.Count -ge 5) { return ($c[1..4] -join "`t") }
      }
    }
    return '?'
  }
  if ($EsWindows) {
    $v = [SystemaPantallas]::Ventana($id)
    if ($v) { return $v } else { return '-' }
  }
  return '?'
}

# Que cada ventana esté de verdad en su pantalla y se vea. Con la escala de
# Windows, Chrome puede abrirla en la de al lado, y si una tele se apaga y se
# enciende entre dos miradas, Windows puede haberse llevado su ventana a otra. Si
# la encuentro fuera, las dos primeras veces la llevo a la suya, que reabrirla
# la dejaría otra vez en el mismo sitio, y la tercera la abro otra vez. Una sin
# ventana (minimizada o cerrada sin cerrar Chrome) tiene que salir así dos veces
# seguidas, y entonces la abro otra vez. Si a la cuarta sigue igual, la cierro
# para que no tape otra pantalla, lo digo, y lo vuelvo a intentar cuando
# cambien las pantallas.
function ComprobarVentanas($plan) {
  foreach ($f in $plan.Filas) {
    $n = $f.Nombre
    if ($null -eq $f.Pantalla -or (Hay $n 'rendida') -or -not (Viva $n)) { continue }
    if ((Edad $n 'desde') -lt $Gracia) { continue }
    $id = [int](Leer (Ruta $n 'pid'))
    $v = VentanaDe $id
    if ($v -eq '?') { continue }
    $p = $f.Pantalla
    if ($v -eq '-') {
      if (-not (Hay $n 'casi')) { Marca $n 'casi'; continue }
      $motivo = 'no tenía ventana (cerrada o minimizada)'
    } else {
      $c = $v -split "`t"
      $cx = [int]$c[0] + [int]$c[2] / 2
      $cy = [int]$c[1] + [int]$c[3] / 2
      if ($cx -ge $p.X -and $cx -lt ($p.X + $p.W) -and $cy -ge $p.Y -and $cy -lt ($p.Y + $p.H)) { Quita $n 'intentos', 'casi'; continue }
      $motivo = 'no estaba en su pantalla'
    }
    Quita $n 'casi'
    $veces = 1 + [int](Leer (Ruta $n 'intentos'))
    Escribir (Ruta $n 'intentos') ([string]$veces)
    if ($veces -gt 3) {
      Cerrar $n
      Marca $n 'rendida'
      Cuenta "no consigo dejar $n bien en su pantalla, así que la cierro para que no tape otra. Lo vuelvo a intentar cuando cambien las pantallas, o al reiniciar"
      continue
    }
    if ($v -ne '-' -and $veces -le 2) {
      Cuenta "$n $motivo, la llevo a la suya"
      if ($EsWindows -and -not $env:SYSTEMA_PANTALLAS_FALSAS) { [void][SystemaPantallas]::Mover($id, $p.X, $p.Y, $p.W, $p.H) }
    } else {
      Cuenta "$n $motivo, la abro otra vez en la suya"
      Abrir $n $f
    }
  }
}

# Si una ventana se ha cerrado sola, la abro otra vez donde iba. Las que he
# cerrado yo (su pantalla se ha ido, le toca otra, me he rendido) ya no tienen
# su .donde, y esas no.
function Revivir($plan) {
  foreach ($f in $plan.Filas) {
    $n = $f.Nombre
    if ($null -eq $f.Pantalla -or (Hay $n 'rendida')) { continue }
    if ((Leer (Ruta $n 'donde')) -ne $f.Clave -or (Viva $n)) { continue }
    if ((Edad $n 'desde') -lt $Reabrir) { continue }
    Cuenta "$n se había cerrado, la vuelvo a abrir"
    Quita $n 'intentos'
    Abrir $n $f
  }
}

# Que la página de cada una esté conectada al servidor. Si la pestaña se cae
# («Aw, Snap») o se queda colgada, Chrome sigue vivo y la tele en negro, pero el
# servidor deja de verla. Si lleva más de $Pagina segundos sin conectar, la
# abro otra vez. Un servidor de antes del 12-oct no da la lista, y entonces no
# miro.
function Paginas($plan) {
  $linea = @(([string]$script:Salud) -split "`r?`n" | Where-Object { $_ -match '^displays ' })
  if ($linea.Count -eq 0) { return }
  $abiertas = @(($linea[0] -replace '^displays ', '') -split ' ')
  foreach ($f in $plan.Filas) {
    $n = $f.Nombre
    if ($null -eq $f.Pantalla -or (Hay $n 'rendida') -or -not (Viva $n)) { continue }
    if ($abiertas -contains $n) { Quita $n 'desconectada'; continue }
    if ((Edad $n 'desde') -lt $Gracia) { continue }
    if (-not (Hay $n 'desconectada')) { Escribir (Ruta $n 'desconectada') ([string](Ahora)); continue }
    if ((Edad $n 'desconectada') -lt $Pagina) { continue }
    Cuenta "la página de $n lleva más de $Pagina s sin conectar con el servidor, la abro otra vez"
    Abrir $n $f
  }
}

# Lo que contesta el servidor a /health?pantallas. La primera línea es ok, y la
# de displays dice qué pantallas tienen su página abierta.
$script:Salud = ''
function Responde([string]$s) {
  $script:Salud = ''
  try {
    $r = Invoke-WebRequest -Uri "$s/health?pantallas" -UseBasicParsing -TimeoutSec 3
    # Los bytes tal cual. Content puede venir como texto o como bytes, según
    # la cabecera y la versión de PowerShell.
    $script:Salud = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    return $script:Salud.StartsWith('ok')
  } catch { return $false }
}

# ---------- Vigilar ----------
function LineaDeOrdenes([int]$id) {
  if ($EsWindows) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine) { return [string]$p.CommandLine }
    return ''
  }
  return [string](& /bin/ps -ww -p $id -o command= 2>$null)
}

# El número del que vigila, si sigue en marcha y es este script. Si no, el
# número es de una vez anterior, o ya lo ha heredado otro programa.
function OtroVigilante {
  $otro = 0
  if (-not [int]::TryParse((Leer (Join-Path $Estado 'vigilante.pid')), [ref]$otro) -or $otro -eq $PID) { return 0 }
  if ((LineaDeOrdenes $otro) -match 'windows\.ps1') { return $otro }
  return 0
}

# Los PowerShell que corren el bucle del acceso de Inicio, por si alguno no ha
# llegado a apuntar su número (si falla al empezar, se queda reintentando).
function Bucles {
  if (-not $EsWindows) { return @() }
  $patron = [regex]::Escape((Join-Path $Base 'windows.ps1'))
  return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $patron -and $_.CommandLine -match '--vigilar' -and $_.ProcessId -ne $PID } |
    ForEach-Object { [int]$_.ProcessId })
}

function Cerrojo {
  $otro = OtroVigilante
  if ($otro) {
    Fallo "ya hay otro vigilando las pantallas de este ordenador (el proceso $otro). Si es el instalado, quítalo antes con windows.cmd --quitar, y si va en otra ventana, ciérralo allí con Ctrl+C"
  }
  Escribir (Join-Path $Estado 'vigilante.pid') ([string]$PID)
}

function Vigilar {
  New-Item -ItemType Directory -Force -Path $Perfiles, $Estado | Out-Null
  Cerrojo
  if ($EsWindows) { [SystemaPantallas]::Despierto() }
  # El registro, que no crezca sin fin.
  if ((Test-Path -LiteralPath $Log) -and (Get-Item -LiteralPath $Log).Length -gt 20MB) {
    Move-Item -LiteralPath $Log -Destination ('{0}.{1}' -f $Log, (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force
  }
  $script:EnArchivo = $true
  foreach ($q in 'sin', 'rendida', 'intentos', 'casi', 'desconectada') { Remove-Item -Path (Join-Path $Estado "*.$q") -ErrorAction SilentlyContinue }
  Cuenta ('pongo {0} con el servidor de {1}' -f ($Nombres -join ' '), $Servidor)
  $aplicado = $null; $firmaAplicada = ''; $vistas = ''; $caido = $null; $vuelta = 0
  try {
    while ($true) {
      try {
        $ok = Responde $Servidor
        if ($ok) {
          if ($caido -eq $true) { Cuenta 'el servidor ya contesta' }
          $caido = $false
        } else {
          # Sin servidor no abro nada. Chrome se quedaría en su página de error,
          # reintentando cada vez más despacio. Las que ya están abiertas se
          # reconectan solas.
          if ($caido -ne $true) { Cuenta "el servidor no contesta en $Servidor, espero a que conteste" }
          $caido = $true
        }
        # Las pantallas, una vuelta sí y otra no. Lo que se queda sin pantalla se
        # cierra en cuanto se ve. Lo demás no se aplica hasta que se lee igual dos
        # veces seguidas, porque una tele al encenderse puede aparecer y
        # desaparecer un par de veces.
        if ($null -eq $aplicado -or ($vuelta % 2) -eq 0) {
          $ahora = @(Pantallas)
          $firmaAhora = (@($ahora | ForEach-Object { '{0} {1} {2} {3} {4} {5}' -f $_.Integrada, $_.Id, $_.X, $_.Y, $_.W, $_.H }) -join ';')
          $plan = Planificar $ahora (Join-Path $Estado 'colocacion')
          Retirar $plan
          if ($ok -and ($null -eq $aplicado -or $firmaAhora -eq $vistas)) {
            if ((Firma $plan) -ne $firmaAplicada) { Colocar $plan; $aplicado = $plan; $firmaAplicada = Firma $plan }
            ComprobarVentanas $aplicado
          }
          $vistas = $firmaAhora
        }
        if ($ok -and $null -ne $aplicado) { Revivir $aplicado; Paginas $aplicado }
      } catch {
        Cuenta "algo ha fallado en esta vuelta, sigo ($($_.Exception.Message))"
      }
      $vuelta++
      Start-Sleep -Milliseconds ([int]($Espera * 1000))
    }
  } finally {
    # Con Ctrl+C también pasa por aquí.
    foreach ($n in $Nombres) { Cerrar $n }
    if ((Leer (Join-Path $Estado 'vigilante.pid')) -eq [string]$PID) { Remove-Item -LiteralPath (Join-Path $Estado 'vigilante.pid') -ErrorAction SilentlyContinue }
    Cuenta 'cierro las pantallas'
  }
}

# ---------- Lo que hace falta ----------
function BuscarServidor {
  if (-not $script:Servidor) {
    foreach ($c in 'http://127.0.0.1', 'http://127.0.0.1:8080') {
      if (Responde $c) { $script:Servidor = $c; return }
    }
    Fallo 'dime dónde está el servidor con --servidor y la IP del Mac que lo lleva, por ejemplo --servidor 192.168.1.20'
  }
  $s = $script:Servidor -replace '/+$', ''
  if ($s -notmatch '^https?://') { $s = "http://$s" }
  if ($s -notmatch '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$') {
    Fallo "«$s» no parece una dirección. Pon la IP del Mac del servidor (192.168.1.20) o http://systema.internal"
  }
  $script:Servidor = $s
  if (-not (Responde $s)) { Write-Output "ojo, el servidor no contesta ahora en $s. Las abro en cuanto conteste" }
}

function BuscarChrome {
  if ($env:CHROME) { $c = @($env:CHROME) }
  else {
    $c = @()
    foreach ($raiz in $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) {
      if ($raiz) { $c += Join-Path $raiz 'Google\Chrome\Application\chrome.exe' }
    }
    try {
      $registro = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction Stop).'(default)'
      if ($registro) { $c += $registro }
    } catch { }
  }
  foreach ($x in $c) { if ($x -and (Test-Path -LiteralPath $x)) { return $x } }
  Fallo 'falta Google Chrome. Se baja de https://www.google.com/chrome y se instala como cualquier programa'
}

# Lo que veo y qué iría en cada una, con lo apuntado, que es lo que aplica el que
# vigila. Al lanzarlo a mano se borra antes, y entonces sale el reparto de
# izquierda a derecha.
function Ver {
  $lista = @(Pantallas)
  if ($lista.Count -eq 0) { Write-Output 'no veo ninguna pantalla'; return }
  $plan = $null
  $memoria = Join-Path $Estado 'colocacion'
  if ($Nombres.Count -gt 0) { $plan = Planificar $lista $memoria }
  Write-Output ('este ordenador ve {0}, de izquierda a derecha' -f (Cuantas $lista.Count))
  $k = 0
  foreach ($p in $lista) {
    $k++
    $que = ''
    if ($null -ne $plan) {
      $que = 'sin nada'
      foreach ($f in $plan.Filas) { if ($null -ne $f.Pantalla -and $f.Pantalla.X -eq $p.X -and $f.Pantalla.Y -eq $p.Y) { $que = "→ $($f.Nombre)" } }
    }
    if ($p.Integrada -and -not $Integrada) { $que = 'la del portátil, que la dejo libre (con --con-integrada la uso)' }
    $nombre = $p.Nombre
    if (-not $nombre) { $nombre = 'pantalla' }
    Write-Output ('  {0}  {1,-28} {2,5}×{3,-5} en {4},{5}  {6}' -f $k, $nombre, $p.W, $p.H, $p.X, $p.Y, $que)
  }
  if ($script:Metodo -eq 'principal') {
    Write-Output '  no sé cuál es la del portátil, así que tomo por ella la principal'
  }
  if ($null -ne $plan) {
    if ($plan.Modo -eq 'en_orden') { Write-Output '  faltan pantallas y no sé cuál, así que van en orden y alguna saldrá en la tele de otra' }
    foreach ($n in $plan.Nuevas) { Write-Output "  $n no encuentra su pantalla de la otra vez y se queda con la que sobra" }
    foreach ($f in $plan.Filas) { if ($null -eq $f.Pantalla) { Write-Output "  $($f.Nombre) se queda sin pantalla hasta que aparezca la suya" } }
    if ((Test-Path -LiteralPath $memoria) -and (Get-Item -LiteralPath $memoria).Length -gt 0) {
      Write-Output '  (es lo apuntado la última vez que estaban todas. Al lanzarlo a mano se reparte otra vez de izquierda a derecha)'
    }
  }
}

# Las ventanas de todos los perfiles, también las de nombres de antes.
function CerrarTodas {
  if (Test-Path -LiteralPath $Perfiles) {
    foreach ($d in @(Get-ChildItem -LiteralPath $Perfiles -Directory)) { Cerrar $d.Name }
  }
}

# El que vigila y los bucles del acceso de Inicio, aunque alguno no haya llegado
# a apuntar su número.
function PararVigilantes {
  $otro = OtroVigilante
  if ($otro) { Stop-Process -Id $otro -Force -ErrorAction SilentlyContinue }
  foreach ($b in @(Bucles)) { Stop-Process -Id $b -Force -ErrorAction SilentlyContinue }
}

function Quitar {
  if ($Acceso -and (Test-Path -LiteralPath $Acceso)) { Remove-Item -LiteralPath $Acceso -Force }
  PararVigilantes
  CerrarTodas
  foreach ($q in 'sin', 'desde', 'rendida', 'intentos', 'casi', 'desconectada') { Remove-Item -Path (Join-Path $Estado "*.$q") -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath (Join-Path $Estado 'vigilante.pid') -ErrorAction SilentlyContinue
  Write-Output 'quitado. Las pantallas ya no se abren solas en este ordenador'
}

function Instalar {
  if (-not $EsWindows) { Fallo 'esto se instala en Windows. En un Mac va mac.sh' }
  New-Item -ItemType Directory -Force -Path $Base, $Estado, $Perfiles | Out-Null
  # Si ya estaba, se para el de antes, con sus ventanas.
  PararVigilantes
  CerrarTodas
  # Como al probar, de izquierda a derecha otra vez.
  Remove-Item -LiteralPath (Join-Path $Estado 'colocacion') -ErrorAction SilentlyContinue
  # El acceso de Inicio lanza una copia de este script que vive en tu carpeta,
  # para que siga funcionando aunque se borre o se mueva la descargada. Va
  # dentro de un bucle, para que si se cae, por lo que sea, lo vuelva a lanzar a
  # los 10 s, como hace launchd en el Mac, y lo apunte en el registro.
  $copia = Join-Path $Base 'windows.ps1'
  Copy-Item -LiteralPath $PSCommandPath -Destination $copia -Force
  $vigilar = @('--vigilar', '--servidor', $Servidor)
  if ($Integrada) { $vigilar += '--con-integrada' }
  $vigilar += $Nombres
  $entre = { param($x) "'" + ($x -replace "'", "''") + "'" }
  $bucle = ('while ($true) {{ try {{ & {0} {1} }} catch {{ try {{ Add-Content -LiteralPath {2} -Value ((Get-Date -Format ''yyyy-MM-dd HH:mm:ss'') + '' el vigilante se ha caído y vuelvo en 10 s, '' + $_) -Encoding UTF8 }} catch {{ }} }}; Start-Sleep -Seconds 10 }}' -f
    (& $entre $copia), (@($vigilar | ForEach-Object { & $entre $_ }) -join ' '), (& $entre $Log))
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', "`"$bucle`"")
  # Por conhost, la consola de siempre. Si no, en Windows 11 lo abriría Windows
  # Terminal, que no se esconde, y cerrar su ventana pararía el vigilante.
  $conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
  if (Test-Path -LiteralPath $conhost) {
    $programa = $conhost
    $argumentos = @("`"$powershell`"") + $argumentos
  } else {
    $programa = $powershell
  }
  $shell = New-Object -ComObject WScript.Shell
  $atajo = $shell.CreateShortcut($Acceso)
  $atajo.TargetPath = $programa
  $atajo.Arguments = $argumentos -join ' '
  $atajo.WorkingDirectory = $Base
  $atajo.WindowStyle = 7   # minimizada, y PowerShell se esconde al empezar
  $atajo.Save()
  Start-Process -FilePath $programa -ArgumentList $argumentos -WindowStyle Minimized | Out-Null
  Ver
  Write-Output ''
  # Que se abran de verdad, hasta 30 s.
  $fin = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 1
    $faltan = @($Nombres | Where-Object { -not (Viva $_) -and -not (Hay $_ 'sin') })
  } while ($faltan.Count -gt 0 -and (Get-Date) -lt $fin)
  foreach ($n in $Nombres) {
    if (Viva $n) { Write-Output "  $n abierta" }
    elseif (Hay $n 'sin') { Write-Output "  $n sin pantalla, se abre en cuanto aparezca la suya" }
    else { Write-Output "  $n todavía no se ha abierto. Mira el registro, $Log" }
  }
  Write-Output ''
  Write-Output "  listo, se abren solas cada vez que se inicia sesión en este usuario, con el servidor de $Servidor"
  Write-Output "  registro   $Log"
  Write-Output '  quitarlo   windows.cmd --quitar'
}

# ---------- Cada modo ----------
switch ($Modo) {
  'ver' { Ver }
  'quitar' { Quitar }
  'vigilar' {
    if ($Nombres.Count -eq 0) { Fallo 'faltan los nombres de las pantallas' }
    if (-not $Servidor) { Fallo 'falta --servidor' }
    $Chrome = BuscarChrome
    BuscarServidor
    Vigilar
  }
  'probar' {
    if ($Nombres.Count -eq 0) { Fallo 'dime qué pantallas pongo en este ordenador, por ejemplo windows.cmd --servidor 192.168.1.20 proyector1 proyector2' }
    if ($Acceso -and (Test-Path -LiteralPath $Acceso)) {
      Fallo 'en este ordenador ya están instaladas, y se abren solas. Para probar a mano, quítalas antes con windows.cmd --quitar'
    }
    $Chrome = BuscarChrome
    BuscarServidor
    New-Item -ItemType Directory -Force -Path $Estado | Out-Null
    $otro = OtroVigilante
    if ($otro) { Fallo "ya hay otro vigilando las pantallas de este ordenador (el proceso $otro). Ciérralo antes con Ctrl+C en su ventana" }
    # A mano se reparte otra vez de izquierda a derecha y se olvida lo apuntado.
    # Así, si dos estaban cambiadas, basta con cambiar el orden de los nombres o
    # de las pantallas y volver a lanzarlo.
    Remove-Item -LiteralPath (Join-Path $Estado 'colocacion') -ErrorAction SilentlyContinue
    Ver
    Write-Output ''
    Write-Output "las abro con el servidor de $Servidor y me quedo vigilándolas. Ctrl+C las cierra"
    Vigilar
  }
  'instalar' {
    if ($Nombres.Count -eq 0) { Fallo 'dime qué pantallas pongo en este ordenador, por ejemplo windows.cmd --instalar --servidor 192.168.1.20 proyector1 proyector2' }
    $Chrome = BuscarChrome
    BuscarServidor
    Instalar
  }
}
