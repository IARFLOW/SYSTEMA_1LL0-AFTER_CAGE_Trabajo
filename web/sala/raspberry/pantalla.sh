#!/bin/sh
# Systema 1LL0~ After Cage · lo que pone esta Raspberry en su tele
#
# Lo lanza el escritorio al entrar (el autostart de labwc que deja
# preparar.sh) a través de lwrespawn, que lo vuelve a lanzar si Chromium se
# cierra. Lee el nombre de la pantalla y la dirección del servidor de
# /boot/firmware/systema.txt, espera a que el servidor conteste y abre
# <servidor>/screen/<nombre> en modo kiosk.
#
# Lo que cuenta va al registro del sistema, y se lee con journalctl -t systema
set -u

CONF=/boot/firmware/systema.txt
PERFIL="$HOME/.config/chromium"

# «clave=valor». La clave da igual en mayúsculas o en minúsculas, y al valor
# se le quitan las comillas, los espacios y el retorno de carro que se cuelan
# al editarlo a mano o desde el Mac. Si una clave sale dos veces, vale la última.
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

# Un aviso en la propia tele, en gris sobre negro, para quien esté montando.
# Sin almohadillas ni signos de porcentaje en el texto, porque en una dirección
# data: cortarían el mensaje.
aviso() {
  logger -t systema "$1 $2" 2>/dev/null
  exec chromium --kiosk --noerrdialogs --no-first-run --password-store=basic \
    "data:text/html;charset=utf-8,<body style='background:black;color:silver;font:4vmin monospace;padding:8vmin'><p>$1</p><p>$2</p></body>"
}

if ! printf '%s\n' "$NOMBRE" | grep -Eq '^[a-z0-9_-]{1,32}$'; then
  aviso "a esta pantalla le falta su nombre. Pon una línea nombre=tele1 (o el que sea)" \
    "en $CONF. Después, reinicia la Raspberry."
fi
if ! printf '%s\n' "$SERVIDOR" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
  aviso "a esta pantalla le falta la dirección del servidor. Pon una línea servidor=http://systema.internal (o la IP del Mac)" \
    "en $CONF. Después, reinicia la Raspberry."
fi
URL="$SERVIDOR/screen/$NOMBRE"

# Plan B, solo si una tele se congela más de una vez. Con decodificar=software
# en systema.txt el vídeo va por la CPU y no por el decodificador de la Pi 4.
# Calienta mucho más. En el informe del fallo, entre el 150 y el 270 % de CPU
# en una Pi 4, según cuánto vídeo hubiera en la página
# (raspberrypi/trixie-feedback#101).
EXTRA=''
if [ "$DECODIFICAR" = software ]; then
  EXTRA='--disable-accelerated-video-decode'
fi

# Si Chromium no está en marcha, el candado de su perfil es de una vez
# anterior. Si además la Pi se llamaba de otra manera, Chromium preguntaría en
# pantalla si «desbloquear el perfil» (process_singleton_posix.cc) y nadie lo
# contestaría. Sin Chromium abierto, quitarlo no rompe nada.
if ! pgrep -u "$(id -u)" -x chromium >/dev/null 2>&1; then
  rm -f "$PERFIL/SingletonLock" "$PERFIL/SingletonSocket" "$PERFIL/SingletonCookie"
fi

# Chromium no se abre hasta que el servidor conteste. Si abriera antes, se
# quedaría en su página de error y la reintentaría cada vez más despacio, al
# segundo, a los 6 s, a los 36 s… hasta una vez cada 30 minutos
# (net_error_auto_reloader.cc). Mientras tanto se ve el escritorio de la Pi.
i=0
until curl -sf -o /dev/null --connect-timeout 3 -m 5 "$SERVIDOR/health"; do
  # Una línea al empezar y luego una cada minuto o dos, sin llenar el registro.
  if [ $((i % 30)) -eq 0 ]; then
    logger -t systema "espero al servidor, que no contesta en $SERVIDOR/health" 2>/dev/null
  fi
  i=$((i + 1))
  sleep 2
done
logger -t systema "abro $URL${EXTRA:+ con $EXTRA}" 2>/dev/null

# --kiosk                pantalla completa, sin barras, y sin los avisos del
#                        arranque (también el de restaurar páginas tras un corte)
# --noerrdialogs         sin ventanas de error
# --no-first-run         sin la bienvenida de la primera vez
# --password-store=basic sin el llavero, porque con el inicio de sesión
#                        automático nadie lo desbloquea y se quedaría pidiendo
#                        contraseña (también va en /etc/chromium.d/systema)
# --autoplay-policy=no-user-gesture-required   suena sin que nadie la toque
# --hide-crash-restore-bubble   de cinturón, que con --kiosk no hace falta
# --disable-infobars no se pone, porque fuera del modo headless ya no hace nada.
# shellcheck disable=SC2086
exec chromium --kiosk --noerrdialogs --no-first-run --password-store=basic \
  --autoplay-policy=no-user-gesture-required --hide-crash-restore-bubble \
  $EXTRA "$URL"
