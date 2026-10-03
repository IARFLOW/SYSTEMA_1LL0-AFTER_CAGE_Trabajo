#!/bin/sh
# Systema 1LL0~ After Cage · cómo está esta Raspberry
#
#   sh /opt/systema/comprobar.sh
#
# Dice «ok» u «ojo» de cada cosa que tiene que estar bien en la sala, y debajo
# algún dato suelto. Para mirar el decodificador y los mensajes del núcleo
# pide la contraseña, si no la tiene ya (sin ella se salta esas dos). Sale con
# 0 si todo está bien. No cambia nada.
set -u

CONF=/boot/firmware/systema.txt
MINIMA='1:152.0.7977.82-1~deb13u1+rpt2'
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
OJOS=0
ok() { printf '  ok    %s\n' "$1"; }
ojo() { printf '  ojo   %s\n' "$1"; OJOS=$((OJOS + 1)); }
dato() { printf '        %s\n' "$1"; }
instalado() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'ok installed$'; }

if [ "$(id -u)" -eq 0 ]; then
  echo "lánzalo sin sudo delante, con sh /opt/systema/comprobar.sh (la contraseña la pide él si hace falta)"
  exit 1
fi

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

# Lo que puede quedarse colgado para siempre (vcgencmd cuando el firmware no
# contesta, grim con la imagen congelada) se lanza aparte, sin atarlo a esta
# salida, y se espera como mucho SEGUNDOS. Si no ha acabado, devuelve 1.
con_limite() {
  segundos=$1
  shift
  f=$(mktemp "$TMP/salida.XXXXXX") || return 1
  ( "$@" > "$f" 2>/dev/null; touch "$f.listo" ) </dev/null >/dev/null 2>&1 &
  n=0
  while [ "$n" -lt $((segundos * 2)) ]; do
    if [ -f "$f.listo" ]; then cat "$f"; return 0; fi
    sleep 0.5
    n=$((n + 1))
  done
  return 1
}

leer() {
  awk -v k="$1" '
    { sub(/\r$/, "") }
    /^[ \t]*#/ { next }
    index($0, "=") == 0 { next }
    {
      clave = substr($0, 1, index($0, "=") - 1)
      gsub(/[ \t]/, "", clave)
      if (tolower(clave) != k) next
      valor = substr($0, index($0, "=") + 1)
      gsub(/"/, "", valor)
      gsub(/^[ \t]+|[ \t]+$/, "", valor)
      ultimo = valor
    }
    END { print ultimo }
  ' "$CONF" 2>/dev/null
}

NOMBRE=$(leer nombre | tr '[:upper:]' '[:lower:]')
SERVIDOR=$(leer servidor | sed 's#/*$##')
# Como en preparar.sh, si se escribió a mano sin http:// delante (la IP del
# Mac, por ejemplo), se pone. Antes la tele decía que le faltaba la dirección.
case "$SERVIDOR" in http://*|https://*|'') ;; *) SERVIDOR="http://$SERVIDOR" ;; esac
DECODIFICAR=$(leer decodificar | tr '[:upper:]' '[:lower:]')

echo "Systema · cómo está esta Raspberry ($(hostname), $(date '+%d/%m %H:%M'))"

# Con la contraseña se miran dos cosas más. Se pide al principio, no a la mitad.
SUDO=no
if sudo -n true 2>/dev/null; then
  SUDO=si
elif [ -t 0 ]; then
  echo "(te pido la contraseña para mirar el decodificador y los mensajes del núcleo. Ctrl+C para saltártelo)"
  # El Ctrl+C le llegaba también a este script, que acababa sin decir nada,
  # justo cuando hacía falta el informe (una tele congelada).
  trap ':' INT
  if sudo -v; then SUDO=si; fi
  trap - INT
fi
echo ""

# ---------- La Pi y su configuración ----------
MODELO=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null)
CODENAME=$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release 2>/dev/null)
case "$MODELO" in
  "Raspberry Pi 4"*) ok "$MODELO, Raspberry Pi OS ${CODENAME:-?}" ;;
  *) ojo "es una ${MODELO:-placa desconocida} y todo esto está pensado para una Pi 4 (README.md)" ;;
esac
[ "$CODENAME" = trixie ] || ojo "el sistema es ${CODENAME:-otro} y hace falta Raspberry Pi OS Trixie (la imagen 2026-09-15)"

NOMBRE_OK=no
if [ ! -f "$CONF" ]; then
  ojo "no hay $CONF. Lo escribe sh preparar.sh"
elif printf '%s\n' "$NOMBRE" | grep -Eq '^[a-z0-9_-]{1,32}$' \
     && printf '%s\n' "$SERVIDOR" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
  ok "pantalla $NOMBRE, servidor $SERVIDOR ($CONF)"
  NOMBRE_OK=si
else
  ojo "en $CONF falta el nombre o el servidor, o no se entienden (nombre=${NOMBRE:-?}, servidor=${SERVIDOR:-?})"
fi
if [ "$NOMBRE_OK" = si ] && [ "$(hostname)" != "$NOMBRE" ]; then
  dato "la Pi se llama $(hostname) en la red, y la pantalla es $NOMBRE"
fi
if [ "$DECODIFICAR" = software ]; then
  ojo "tiene puesto el plan B (decodificar=software), así que el vídeo va por la CPU y calienta más"
fi

# ---------- Chromium ----------
VCHROMIUM=$(dpkg-query -W -f='${Version}' chromium 2>/dev/null)
CONGELADOS=$(apt-mark showhold 2>/dev/null)
SUELTOS=''
for p in chromium chromium-common chromium-sandbox; do
  printf '%s\n' "$CONGELADOS" | grep -qx "$p" || SUELTOS="$SUELTOS $p"
done
if [ -z "$VCHROMIUM" ]; then
  ojo "chromium no está instalada"
elif ! dpkg --compare-versions "$VCHROMIUM" ge "$MINIMA"; then
  ojo "chromium es la $VCHROMIUM y hace falta la 152.0.7977.82 rpt2 o una posterior (README.md)"
elif [ -n "$SUELTOS" ]; then
  ojo "chromium $VCHROMIUM, pero falta congelar$SUELTOS (sh preparar.sh la congela)"
else
  ok "chromium $VCHROMIUM, congelada"
fi

POL=/etc/chromium/policies/managed/systema.json
if [ -f "$POL" ] && python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if d.get("TranslateEnabled") is False and d.get("AutoplayAllowed") is True else 1)
' "$POL" 2>/dev/null; then
  ok "políticas de chromium en su sitio ($POL)"
else
  ojo "faltan las políticas de chromium en $POL, o están mal (sh preparar.sh)"
fi
if grep -qs -- '--password-store=basic' /etc/chromium.d/systema; then
  ok "chromium sin llavero (/etc/chromium.d/systema)"
else
  ojo "falta /etc/chromium.d/systema, y chromium podría quedarse pidiendo la contraseña del llavero (sh preparar.sh)"
fi

# ---------- Arranque ----------
if grep -q "^autologin-user=$(id -un)\$" /etc/lightdm/lightdm.conf 2>/dev/null \
   && grep -qs 'lwrespawn .*pantalla\.sh' "$HOME/.config/labwc/autostart"; then
  ok "arranca sola, entra en el escritorio sin contraseña y abre la pantalla (con lwrespawn)"
else
  ojo "no arranca sola, porque falta el inicio de sesión automático o el autostart (sh preparar.sh)"
fi

# El proceso principal de Chromium es el que no lleva --type= (los demás son
# sus pestañas, la GPU…). Su línea de órdenes dice qué ha abierto y con qué.
PRINCIPAL=''
# Con límite de tiempo, porque en el cuelgue del decodificador leer de un proceso
# de Chromium bloqueado podría quedarse esperando.
for p in $(pgrep -u "$(id -u)" -x chromium 2>/dev/null); do
  if ! con_limite 3 cat "/proc/$p/cmdline" | tr '\0' '\n' | grep -q '^--type='; then PRINCIPAL=$p; break; fi
done
if [ -n "$PRINCIPAL" ]; then
  con_limite 3 cat "/proc/$PRINCIPAL/cmdline" | tr '\0' '\n' > "$TMP/cmdline"
  FALTAN=''
  for f in --kiosk --password-store=basic --autoplay-policy=no-user-gesture-required; do
    grep -qx -- "$f" "$TMP/cmdline" || FALTAN="$FALTAN $f"
  done
  if [ "$NOMBRE_OK" = si ] && grep -qxF -- "$SERVIDOR/screen/$NOMBRE" "$TMP/cmdline" && [ -z "$FALTAN" ]; then
    ok "la pantalla está abierta en $SERVIDOR/screen/$NOMBRE, en modo kiosk"
  elif grep -q '^data:text/html' "$TMP/cmdline"; then
    ojo "la tele enseña un aviso, porque falta el nombre o el servidor en $CONF"
  else
    ojo "chromium está abierta, pero no con la pantalla de Systema${FALTAN:+ (le falta$FALTAN)}"
  fi
elif pgrep -u "$(id -u)" -f '/opt/systema/pantalla\.sh' >/dev/null 2>&1; then
  ojo "la pantalla espera al servidor, que no contesta, y mientras la tele enseña el escritorio"
else
  ojo "la pantalla no está en marcha (has reiniciado después de preparar.sh?)"
fi

# ---------- Que no se apague, y el watchdog ----------
if pgrep -x swayidle >/dev/null 2>&1 \
   || grep -qs swayidle "$HOME/.config/labwc/autostart" /etc/xdg/labwc-greeter/autostart; then
  ojo "swayidle está puesto, y la pantalla se apagaría a los 10 minutos sin ratón ni teclado (sh preparar.sh lo quita)"
else
  ok "la pantalla no se apaga sola, porque no hay swayidle"
fi

WD=$(systemctl show -p RuntimeWatchdogUSec --value 2>/dev/null)
case "$WD" in
  ''|0|infinity) ojo "watchdog apagado${WD:+ ($WD)}. Lo pone sh preparar.sh, y cuenta desde el siguiente arranque" ;;
  *) ok "el watchdog reinicia la Pi a los $WD si el sistema se cuelga entero" ;;
esac

# ---------- La tele y el sonido ----------
HDMI=''
for c in /sys/class/drm/card*-HDMI-A-1 /sys/class/drm/card*-HDMI-A-2; do
  [ -r "$c/status" ] || continue
  if [ "$(cat "$c/status")" = connected ]; then HDMI=${c##*-HDMI-A-}; break; fi
done
case "$HDMI" in
  1) ok "hay una tele en el HDMI0 (el conector de al lado de la USB-C)" ;;
  2) ojo "la tele está en el HDMI1. Mejor en el HDMI0, el conector de al lado de la USB-C" ;;
  *) ojo "no veo ninguna tele en los HDMI (apagada, o el cable suelto?)" ;;
esac

if ! wpctl status >/dev/null 2>&1; then
  ojo "no puedo preguntar por el sonido (wpctl). Ha entrado ya el escritorio?"
else
  SALIDA=$(wpctl inspect @DEFAULT_AUDIO_SINK@ 2>/dev/null | sed -n 's/.*node\.name = "\(.*\)".*/\1/p' | head -n 1)
  VOL=$(wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null)
  NIVEL=$(printf '%s\n' "$VOL" | awk 'NF >= 2 { printf "%d", $2 * 100 + 0.5 }')
  case "$SALIDA" in
    *hdmi*)
      case "$SALIDA" in *fef00700*) PUERTO="el HDMI0" ;; *fef05700*) PUERTO="el HDMI1" ;; *) PUERTO="el HDMI" ;; esac
      if printf '%s\n' "$VOL" | grep -q MUTED; then
        ojo "el sonido sale por $PUERTO, pero está silenciado. Se quita con wpctl set-mute @DEFAULT_AUDIO_SINK@ 0"
      elif [ "${NIVEL:-0}" -lt 100 ]; then
        ojo "el sonido sale por $PUERTO, pero al ${NIVEL:-?} %. Se pone al 100 % con wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0"
      else
        ok "el sonido sale por $PUERTO, al $NIVEL % ($SALIDA)"
      fi ;;
    '') ojo "no hay salida de sonido. La tele está apagada o en otra entrada? (wpctl status)" ;;
    *) ojo "el sonido sale por $SALIDA y no por el HDMI (wpctl status)" ;;
  esac
fi

# ---------- El overlay ----------
FS=$(findmnt -n -o FSTYPE /)
if [ "$FS" = overlay ]; then
  ok "overlay activo de verdad (/ es overlay), y lo que se escriba se pierde al reiniciar"
elif grep -q 'overlayroot=tmpfs' /proc/cmdline; then
  ojo "raspi-config pidió el overlay, pero / es $FS y no está activo (falta el paquete overlayroot?)"
elif instalado overlayroot; then
  ojo "el overlay aún no está puesto, y es lo último, en casa (README.md)"
else
  ojo "el overlay aún no está puesto, y falta overlayroot (sh preparar.sh, con internet)"
fi
if findmnt -n -o OPTIONS /boot/firmware | tr ',' '\n' | grep -qx ro; then
  dato "la partición de arranque (/boot/firmware) está en solo lectura"
fi

# ---------- El servidor y la red ----------
if [ "$NOMBRE_OK" = si ]; then
  ANFITRION=$(printf '%s\n' "$SERVIDOR" | sed -E 's#^https?://##; s#:[0-9]+$##')
  IP=$(getent hosts "$ANFITRION" 2>/dev/null | awk '{ print $1; exit }')
  if curl -sf -o /dev/null --connect-timeout 3 -m 5 "$SERVIDOR/health"; then
    if curl -sf --connect-timeout 3 -m 5 "$SERVIDOR/screen/$NOMBRE" 2>/dev/null | grep -q 'screen\.js'; then
      ok "llega al servidor en $SERVIDOR${IP:+ ($IP)} y a su página /screen/$NOMBRE"
    else
      ojo "el servidor contesta, pero no da la página /screen/$NOMBRE"
    fi
  elif [ -z "$IP" ]; then
    ojo "no encuentro $ANFITRION, porque el router no da ese nombre. Pon la IP del Mac (README.md, «Cambiar el nombre o el servidor»)"
  else
    ojo "no llega al servidor. $SERVIDOR ($IP) no contesta. Está el Mac encendido y con el servidor en marcha?"
  fi
fi

CABLE=$(nmcli -t -f TYPE,STATE device 2>/dev/null | grep -c '^ethernet:connected')
WIFI=$(nmcli -t -f ACTIVE,SSID,SIGNAL device wifi list --rescan no 2>/dev/null | grep '^yes:' | head -n 1)
if [ "${CABLE:-0}" -gt 0 ]; then
  dato "la red va por cable"
fi
if [ -n "$WIFI" ]; then
  SSID=$(printf '%s\n' "$WIFI" | sed 's/^yes://; s/:[0-9]*$//; s/\\:/:/g')
  SENAL=${WIFI##*:}
  dato "la wi-fi es ${SSID}, con la señal al ${SENAL} %"
  PAIS=$(iw reg get 2>/dev/null | sed -n 's/^country \([A-Z0-9]*\):.*/\1/p' | head -n 1)
  if [ -n "$PAIS" ] && [ "$PAIS" != ES ]; then
    ojo "el país de la wi-fi es $PAIS y tiene que ser ES (sudo raspi-config, Localisation Options, WLAN Country)"
  fi
fi

# ---------- El vídeo ----------
# El decodificador de H.264 de la Pi 4 (bcm2835-codec), normalmente /dev/video10.
DEC=''
for n in /sys/class/video4linux/video*/name; do
  [ -r "$n" ] || continue
  if grep -q 'codec-decode' "$n"; then DEC="/dev/$(basename "$(dirname "$n")")"; break; fi
done
DEC=${DEC:-/dev/video10}
if [ "$SUDO" = si ]; then
  USA=''
  for pid in $(con_limite 10 sudo -n lsof -t "$DEC"); do
    [ "$(cat "/proc/$pid/comm" 2>/dev/null)" = chromium ] && USA=$pid
  done
  if [ -n "$USA" ]; then
    ok "decodifica por hardware ahora mismo (chromium tiene abierto $DEC)"
  elif [ "$DECODIFICAR" = software ]; then
    dato "el decodificador ($DEC) está libre, que es lo esperado con el plan B"
  else
    dato "ahora nadie usa el decodificador ($DEC). Si la tele está poniendo un vídeo, va por la CPU (README.md)"
  fi

  # Lo que escribía el núcleo cuando el decodificador colgaba la Pi 4
  # (raspberrypi/trixie-feedback#101).
  PATRON='timed out waiting for sync completion|bcm2835_codec_[a-z_]*: (Failed|Timeout)|Firmware transaction .* timeout|Failed to (change|set clock) fw-clk|Failed submitting ip buffer|blocked for more than'
  # journalctl va con sudo y lo que escribe se guarda aquí, a mi nombre, y así está bien.
  # shellcheck disable=SC2024
  sudo journalctl -k -b --no-pager -q > "$TMP/nucleo" 2>/dev/null
  if [ ! -s "$TMP/nucleo" ]; then
    dato "no he podido leer los mensajes del núcleo (sudo journalctl -k -b)"
  else
    N=$(grep -Ec "$PATRON" "$TMP/nucleo")
    if [ "$N" -eq 0 ]; then
      ok "sin errores del decodificador ni del firmware desde que arrancó"
    else
      ojo "$N mensajes del núcleo como los del cuelgue del decodificador. Estos son los últimos."
      grep -E "$PATRON" "$TMP/nucleo" | tail -n 3 | sed 's/^/        /'
    fi
  fi
else
  dato "sin la contraseña no miro el decodificador ni los mensajes del núcleo"
fi

# ---------- Temperatura, corriente y firmware ----------
# La temperatura la da el núcleo. get_throttled se le pregunta al firmware, y
# si el firmware no contesta, vcgencmd se queda colgado. Por eso va con límite.
MILI=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)
GRADOS=$(awk -v t="$MILI" 'BEGIN { printf "%.1f", t / 1000 }' | tr '.' ',')
if R=$(con_limite 5 vcgencmd get_throttled) && case "$R" in throttled=0x[0-9a-fA-F]*) true ;; *) false ;; esac; then
  # Solo vale si el firmware contesta de verdad. Un vcgencmd que falla rápido
  # daba «0x0» y salía «ok».
  HEX=${R#throttled=}
  V=$((HEX))
  if [ "$V" -eq 0 ] && [ "$MILI" -lt 80000 ]; then
    ok "${GRADOS} °C, y no se ha frenado ni le ha faltado corriente desde que arrancó (get_throttled $HEX)"
  else
    QUE=''
    [ $((V & 0x1)) -ne 0 ] && QUE="$QUE · le falta corriente ahora"
    [ $((V & 0x10000)) -ne 0 ] && QUE="$QUE · le ha faltado corriente (es la fuente oficial de 3 A?)"
    [ $((V & 0x4)) -ne 0 ] && QUE="$QUE · está frenada ahora"
    [ $((V & 0x40000)) -ne 0 ] && QUE="$QUE · se ha frenado"
    [ $((V & 0x20002)) -ne 0 ] && QUE="$QUE · ha bajado la frecuencia"
    [ $((V & 0x80008)) -ne 0 ] && QUE="$QUE · ha llegado al límite de temperatura"
    [ "$MILI" -ge 80000 ] && QUE="$QUE · a partir de 80 °C se frena"
    ojo "${GRADOS} °C${QUE} (get_throttled $HEX)"
  fi
else
  ojo "${GRADOS} °C, pero el firmware no contesta (vcgencmd se queda colgado), que es lo que pasaba cuando el decodificador colgaba la Pi. Reiníciala"
fi

# Sigue saliendo imagen? Cuando el decodificador colgaba la Pi 4, wlr-randr
# contestaba pero grim no conseguía capturar la pantalla (trixie-feedback#101).
# Solo con una tele conectada, que sin ella no hay imagen que capturar.
SOCK=''
for s in "$XDG_RUNTIME_DIR"/wayland-?; do
  if [ -S "$s" ]; then SOCK=$s; break; fi
done
case "$HDMI" in
  1|2)
    if [ -n "$SOCK" ] && command -v grim >/dev/null 2>&1; then
      W=$(basename "$SOCK")
      MODO=$(con_limite 5 env WAYLAND_DISPLAY="$W" wlr-randr \
        | sed -n 's/^ *\([0-9]*x[0-9]*\) px, \([0-9]*\)\.[0-9]* Hz.*current.*/\1 a \2 Hz/p' | head -n 1)
      if BYTES=$(con_limite 10 sh -c "WAYLAND_DISPLAY=$W grim -t ppm - | wc -c"); then
        if [ "${BYTES:-0}" -gt 1000 ]; then
          ok "sale imagen y se puede capturar la pantalla${MODO:+ ($MODO)}"
        else
          dato "no he podido capturar la pantalla con grim${MODO:+ ($MODO)}"
        fi
      else
        ojo "la pantalla no se deja capturar en 10 s, y la imagen puede estar congelada. Reinicia la Pi"
      fi
    fi ;;
esac

# ---------- Para la prueba larga ----------
LIBRE=$(awk '/^MemAvailable:/ { printf "%d", $2 / 1024 }' /proc/meminfo)
TOTAL=$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo)
dato "tiene libres $LIBRE de sus $TOTAL MB de memoria"
if mountpoint -q /media/root-rw 2>/dev/null; then
  USO=$(df -m /media/root-rw | awk 'NR == 2 { print $3 }')
  dato "lleva $USO MB escritos en memoria desde que arrancó (por el overlay)"
fi
SEG=$(awk '{ printf "%d", $1 }' /proc/uptime)
dato "encendida desde hace $((SEG / 3600)) h $((SEG % 3600 / 60)) min"

echo ""
case "$OJOS" in
  0) echo "  todo bien"; exit 0 ;;
  1) echo "  1 cosa que mirar (la del «ojo»)"; exit 1 ;;
  *) echo "  $OJOS cosas que mirar (las del «ojo»)"; exit 1 ;;
esac
