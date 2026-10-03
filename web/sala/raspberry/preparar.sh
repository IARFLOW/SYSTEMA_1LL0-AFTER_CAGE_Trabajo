#!/bin/sh
# Systema 1LL0~ After Cage · deja una Raspberry Pi lista para su tele de la sala
#
#   sh preparar.sh tele3 http://systema.internal   la primera vez
#   sh preparar.sh                                  otra vez, con lo que ya tenía
#   sh preparar.sh tele3 http://192.168.8.10        cambiar el nombre o el servidor
#
# Se lanza en la propia Pi, con tu usuario y sin sudo delante. La contraseña
# la pide él, una vez, para lo que toca el sistema. Volver a lanzarlo es
# seguro, porque lo que ya está bien no se toca. La primera vez, sin internet,
# porque lo primero que hace es congelar Chromium. La segunda, con el cable de
# red, para bajar overlayroot. Lo que deja, y por qué, lo cuento en README.md.
#
# El overlay (la tarjeta en solo lectura) no lo pone. Va aparte y es lo último.
set -u

AQUI=$(cd "$(dirname "$0")" && pwd)
BOOT=/boot/firmware
CONF=$BOOT/systema.txt
DESTINO=/opt/systema
POLITICAS=/etc/chromium/policies/managed
# La Chromium que arregla el cuelgue de la Pi 4 al acabar un vídeo
# (raspberrypi/trixie-feedback#101), la de la imagen 2026-09-15.
MINIMA='1:152.0.7977.82-1~deb13u1+rpt2'
USUARIO=$(id -un)
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

FALTA=''
listo() { echo "  listo      $1"; }
ya() { echo "  ya estaba  $1"; }
ojo() { echo "  ojo        $1"; }
falta() { FALTA="$FALTA
    $1"; }
muere() {
  echo ""
  for linea in "$@"; do echo "$linea"; done
  exit 1
}
instalado() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'ok installed$'; }

# «clave=valor» de systema.txt, como lo lee pantalla.sh.
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

# ---------- Antes de tocar nada ----------
if [ "$(id -u)" -eq 0 ]; then
  muere "lánzalo sin sudo delante, con sh preparar.sh tele3 http://systema.internal" \
        "la contraseña la pide él donde hace falta, y así el escritorio y el sonido quedan a tu nombre."
fi
MODELO=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)
case "$MODELO" in
  "Raspberry Pi 4"*) ;;
  "Raspberry Pi"*) ;;
  *) muere "esto no parece una Raspberry Pi (${MODELO:-sin modelo en /proc/device-tree/model})" ;;
esac
CODENAME=$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release 2>/dev/null)
if [ "$CODENAME" != trixie ]; then
  muere "este sistema no es Raspberry Pi OS Trixie (${CODENAME:-sin nombre})." \
        "graba la tarjeta con la imagen 2026-09-15 (README.md, «Grabar la tarjeta»)."
fi
for p in labwc chromium raspi-config wpctl curl python3; do
  command -v "$p" >/dev/null 2>&1 || muere "falta $p. Es la imagen con escritorio? La Lite no lo trae."
done
[ -x /usr/bin/lwrespawn ] || muere "falta /usr/bin/lwrespawn (paquete rpd-wayland-core). Es la imagen con escritorio?"
for f in pantalla.sh comprobar.sh systema.json; do
  [ -f "$AQUI/$f" ] || muere "no encuentro $AQUI/$f. Copia la carpeta entera."
done
if [ "$(findmnt -n -o FSTYPE /)" = overlay ]; then
  muere "el overlay está puesto, y lo que cambie ahora se perdería al reiniciar." \
        "se quita con sudo raspi-config nonint do_overlayfs 1, y luego sudo reboot." \
        "para cambiar solo el nombre o el servidor no hace falta (README.md, «Cambiar el nombre o el servidor»)."
fi

# ---------- El nombre y el servidor ----------
DECODIFICAR=$(leer decodificar | tr '[:upper:]' '[:lower:]')
if [ $# -gt 2 ]; then
  muere "se lanza con sh preparar.sh <nombre> [servidor], por ejemplo sh preparar.sh tele3 http://systema.internal"
elif [ $# -ge 1 ]; then
  NOMBRE=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  SERVIDOR=${2:-http://systema.internal}
elif [ -f "$CONF" ]; then
  NOMBRE=$(leer nombre | tr '[:upper:]' '[:lower:]')
  SERVIDOR=$(leer servidor)
else
  muere "se lanza con sh preparar.sh <nombre> [servidor], por ejemplo sh preparar.sh tele3 http://systema.internal" \
        "el nombre es el de la pantalla, el mismo que usa Max (/tele3/video 5)."
fi
case "$SERVIDOR" in
  http://*|https://*) ;;
  *) SERVIDOR="http://$SERVIDOR" ;;
esac
SERVIDOR=$(printf '%s' "$SERVIDOR" | sed 's#/*$##')
# Como en el servidor (screenName en server/index.js), letras, números, _ y -.
if ! printf '%s\n' "$NOMBRE" | grep -Eq '^[a-z0-9_-]{1,32}$'; then
  muere "«${NOMBRE}» no vale como nombre de pantalla. Solo letras, números, _ y -, como tele1 o tele2."
fi
if ! printf '%s\n' "$SERVIDOR" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
  muere "«${SERVIDOR}» no parece la dirección del servidor. Tiene que ser http://systema.internal o la IP del Mac (http://192.168.8.10)."
fi

echo "Systema · preparo esta Raspberry para la pantalla ${NOMBRE}, con el servidor en ${SERVIDOR}"
case "$MODELO" in
  "Raspberry Pi 4"*) ;;
  "Raspberry Pi 5"*) ojo "es una Pi 5, y el vídeo irá por la CPU porque no tiene decodificador de H.264. Necesita la fuente de 27 W y ventilador (README.md)." ;;
  *) ojo "es una $MODELO, y todo esto está pensado para la Pi 4." ;;
esac
echo "te pido la contraseña de la Pi (la de Imager) para lo que toca el sistema."
sudo -v || muere "sin la contraseña no puedo seguir."

TMP=$(mktemp -d) || muere "no puedo crear una carpeta temporal."
trap 'rm -rf "$TMP"' EXIT

# La partición de arranque se queda en solo lectura con el overlay, y así
# sigue después de quitarlo. Se abre mientras dura esto y se deja como estaba.
BOOT_RO=no
if findmnt -n -o OPTIONS "$BOOT" | tr ',' '\n' | grep -qx ro; then
  sudo mount -o remount,rw "$BOOT" || muere "no puedo escribir en $BOOT."
  BOOT_RO=si
fi

# ---------- 1. Chromium, congelada (lo primero, antes de que haya internet) ----------
VCHROMIUM=$(dpkg-query -W -f='${Version}' chromium 2>/dev/null)
if ! dpkg --compare-versions "$VCHROMIUM" ge "$MINIMA"; then
  muere "esta Chromium es la ${VCHROMIUM}, anterior a la 152.0.7977.82 rpt2 de la imagen 2026-09-15." \
        "la 151 y la 152 rpt1 cuelgan la Pi 4 al acabar un vídeo (raspberrypi/trixie-feedback#101)." \
        "lo mejor es grabar la tarjeta otra vez con la imagen 2026-09-15 (README.md)." \
        "si no, con internet, haz sudo apt update && sudo apt install chromium chromium-common chromium-sandbox chromium-l10n" \
        "y vuelve a lanzar esto."
fi
# chromium y los paquetes que van con ella, y los ajustes de Raspberry Pi para
# Chromium (rpi-chromium-mods, que pone opciones en /etc/chromium.d/).
PAQUETES=$(dpkg-query -W -f='${Package} ${Status}\n' 'chromium*' rpi-chromium-mods 2>/dev/null | awk '$NF == "installed" { print $1 }')
CONGELADOS=$(apt-mark showhold 2>/dev/null)
NUEVOS=''
for p in $PAQUETES; do
  printf '%s\n' "$CONGELADOS" | grep -qx "$p" || NUEVOS="$NUEVOS $p"
done
LISTA=$(printf '%s\n' "$PAQUETES" | tr '\n' ' ' | sed 's/ *$//')
if [ -n "$NUEVOS" ]; then
  # shellcheck disable=SC2086
  sudo apt-mark hold $NUEVOS >/dev/null || muere "no he podido congelar Chromium (apt-mark hold)."
  listo "chromium $VCHROMIUM congelada, y un apt upgrade ya no la cambia ($LISTA)"
else
  ya "chromium $VCHROMIUM congelada ($LISTA)"
fi

# ---------- 2. Qué pone esta Pi, en el systema.txt de la partición de arranque ----------
# Ahí no le afecta el overlay, y se puede cambiar también desde el Mac.
{
  echo "# Systema 1LL0~ After Cage · qué pone esta Raspberry"
  echo "#"
  echo "# En nombre va el de la pantalla, el mismo que usa Max (/tele1/video 3)."
  echo "# En servidor va el Mac de la sala. Si el router no da el nombre systema.internal,"
  echo "#   pon la IP del Mac con http:// delante (servidor=http://192.168.8.10)."
  echo "# Se puede cambiar a mano, también desde el Mac con la tarjeta metida (es el"
  echo "# disco bootfs). Después, reinicia la Raspberry. Lo escribe preparar.sh."
  echo "nombre=$NOMBRE"
  echo "servidor=$SERVIDOR"
  echo ""
  echo "# Plan B, solo si esta tele se congela más de una vez (README.md, «Si algo va mal»)."
  echo "# El vídeo va por la CPU y no por el decodificador. Calienta mucho más."
  if [ "$DECODIFICAR" = software ]; then
    echo "decodificar=software"
  else
    echo "# decodificar=software"
  fi
} > "$TMP/systema.txt"
if [ -f "$CONF" ] && cmp -s "$TMP/systema.txt" "$CONF"; then
  ya "pantalla $NOMBRE, servidor $SERVIDOR ($CONF)"
else
  { sudo cp "$TMP/systema.txt" "$CONF" && sync; } || muere "no he podido escribir $CONF."
  listo "pantalla $NOMBRE, servidor $SERVIDOR ($CONF)"
fi
if [ "$DECODIFICAR" = software ]; then
  ojo "esta pantalla tiene puesto el plan B (decodificar=software en $CONF), así que el vídeo va por la CPU."
fi

# ---------- 3. Los scripts, en /opt/systema ----------
CAMBIA=no
sudo install -d -m 755 "$DESTINO" || muere "no he podido crear $DESTINO."
for f in pantalla.sh comprobar.sh; do
  if ! cmp -s "$AQUI/$f" "$DESTINO/$f"; then
    sudo install -m 755 "$AQUI/$f" "$DESTINO/$f" || muere "no he podido copiar $f a $DESTINO."
    CAMBIA=si
  fi
done
if [ "$CAMBIA" = si ]; then listo "pantalla.sh y comprobar.sh en $DESTINO"; else ya "pantalla.sh y comprobar.sh en $DESTINO"; fi

# Copia ORIGEN a DESTINO (de root) con MODO, solo si ha cambiado. Dice qué ha hecho con TEXTO.
poner() {
  if [ -f "$2" ] && cmp -s "$1" "$2"; then ya "$4"; return 0; fi
  sudo install -D -m "$3" "$1" "$2" || muere "no he podido escribir $2."
  listo "$4"
}
# Lo mismo para un fichero de tu carpeta personal. Devuelve 0 si lo ha cambiado.
poner_mio() {
  if [ -f "$2" ] && cmp -s "$1" "$2"; then ya "$3"; return 1; fi
  # rm antes de copiar, porque si raspi-config lo dejó a nombre de root, así se puede reescribir.
  if ! { mkdir -p "$(dirname "$2")" && rm -f "$2" && cp "$1" "$2" && chmod 644 "$2"; }; then
    muere "no he podido escribir $2."
  fi
  listo "$3"
  return 0
}

# ---------- 4. Chromium, con sus políticas y sin llavero ----------
python3 -m json.tool "$AQUI/systema.json" >/dev/null 2>&1 || muere "$AQUI/systema.json no es un JSON válido."
poner "$AQUI/systema.json" "$POLITICAS/systema.json" 644 \
  "políticas de chromium en $POLITICAS (sin traducir, vídeo con sonido sin tocar, caché de 100 MB, sin extensiones)"

cat > "$TMP/chromium.d" <<'EOF'
# Systema 1LL0~ After Cage · lo pone preparar.sh
# Sin el llavero, porque con el inicio de sesión automático nadie lo desbloquea y
# Chromium se quedaría pidiendo una contraseña. Aquí vale para cualquier
# Chromium que se abra en esta Pi, no solo el de la pantalla.
export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --password-store=basic"
EOF
poner "$TMP/chromium.d" /etc/chromium.d/systema 644 "chromium sin llavero (/etc/chromium.d/systema)"

# ---------- 5. Que arranque sola ----------
cat > "$TMP/autostart" <<EOF
# Systema 1LL0~ After Cage · lo escribe preparar.sh, y lo rehace cada vez
# La pantalla de la sala. lwrespawn la vuelve a lanzar si Chromium se cierra.
/usr/bin/lwrespawn $DESTINO/pantalla.sh &
EOF
poner_mio "$TMP/autostart" "$HOME/.config/labwc/autostart" \
  "la pantalla se abre sola al entrar en el escritorio (~/.config/labwc/autostart)" || true

if grep -q "^autologin-user=$USUARIO\$" /etc/lightdm/lightdm.conf 2>/dev/null \
   && [ "$(systemctl get-default 2>/dev/null)" = graphical.target ]; then
  ya "entra sola en el escritorio, sin contraseña, como $USUARIO"
elif sudo raspi-config nonint do_boot_behaviour B4; then
  listo "entra sola en el escritorio, sin contraseña, como $USUARIO"
else
  ojo "no he podido poner el inicio de sesión automático (raspi-config, B4 Desktop Autologin)"
  falta "el inicio de sesión automático, con sudo raspi-config, System Options, Boot / Auto Login, B4"
fi

# ---------- 6. Que la pantalla no se apague ----------
# raspi-config solo toca labwc si el escritorio está en marcha (pgrep labwc).
# Después se comprueba igual, y se quita a mano lo que quede.
if pgrep -x labwc >/dev/null 2>&1; then
  sudo raspi-config nonint do_blanking 1 >/dev/null 2>&1 || true
fi
if grep -qs swayidle /etc/xdg/labwc-greeter/autostart; then
  sudo sed -i '/swayidle/d' /etc/xdg/labwc-greeter/autostart
fi
if grep -qs swayidle "$HOME/.config/labwc/autostart" /etc/xdg/labwc-greeter/autostart; then
  ojo "sigue habiendo una línea de swayidle, y la pantalla se apagaría a los 10 minutos sin ratón ni teclado"
  falta "quitar swayidle de ~/.config/labwc/autostart y /etc/xdg/labwc-greeter/autostart"
else
  listo "la pantalla no se apaga sola, sin swayidle (raspi-config nonint do_blanking 1)"
fi

# ---------- 7. El watchdog ----------
cat > "$TMP/watchdog.conf" <<'EOF'
# Systema 1LL0~ After Cage · lo pone preparar.sh
# Si se cuelga el sistema entero (el núcleo o systemd), el watchdog de la Pi
# la reinicia a los 14 s. systemd lo trae apagado (RuntimeWatchdogSec=0), y
# el temporizador de la Pi cuenta hasta unos 15 s (bcm2835_wdt.c).
# No ve una imagen congelada con el sistema vivo.
[Manager]
RuntimeWatchdogSec=14s
EOF
poner "$TMP/watchdog.conf" /etc/systemd/system.conf.d/systema-watchdog.conf 644 \
  "el watchdog, que reinicia la Pi a los 14 s si el sistema se cuelga entero (cuenta desde el próximo arranque)"

# ---------- 8. El sonido, por el HDMI ----------
cat > "$TMP/hdmi.conf" <<'EOF'
# Systema 1LL0~ After Cage · lo pone preparar.sh
# El sonido, siempre por el HDMI de la tele.
#
# La prioridad. Las salidas normales van de 600 a 1000, y la documentación de
# WirePlumber 0.5.8 pide no pasar de 1500 en una salida. El HDMI0 (fef00700
# en la Pi 4, el conector de al lado de la USB-C) va por delante del HDMI1.
# Con session.suspend-timeout-seconds = 0 la salida no se suspende nunca, ni
# entre un vídeo y otro.
monitor.alsa.rules = [
  {
    matches = [ { node.name = "~alsa_output.*hdmi.*" } ]
    actions = {
      update-props = {
        priority.session = 1400
        session.suspend-timeout-seconds = 0
      }
    }
  }
  {
    matches = [ { node.name = "~alsa_output.platform-fef00700.hdmi.*" } ]
    actions = {
      update-props = {
        priority.session = 1500
      }
    }
  }
]

# Sin recordar la salida elegida a mano, que manda la prioridad. Y la salida al
# 100 % cuando no hay un volumen guardado, porque el volumen se pone en la tele.
wireplumber.settings = {
  node.restore-default-targets = false
  device.routes.default-sink-volume = 1.0
}
EOF
if poner_mio "$TMP/hdmi.conf" "$HOME/.config/wireplumber/wireplumber.conf.d/50-systema-hdmi.conf" \
     "el sonido prefiere el HDMI (~/.config/wireplumber/wireplumber.conf.d/50-systema-hdmi.conf)"; then
  systemctl --user restart wireplumber >/dev/null 2>&1 && sleep 3
fi
SALIDA=$(wpctl inspect @DEFAULT_AUDIO_SINK@ 2>/dev/null | sed -n 's/.*node\.name = "\(.*\)".*/\1/p' | head -n 1)
case "$SALIDA" in
  *hdmi*)
    wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0 >/dev/null 2>&1
    wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 >/dev/null 2>&1
    case "$SALIDA" in
      *fef00700*) listo "el sonido sale por el HDMI0, al 100 %, y el volumen se pone en la tele ($SALIDA)" ;;
      *fef05700*) listo "el sonido sale por el HDMI1, al 100 % ($SALIDA)"
                  ojo "mejor la tele en el HDMI0, el conector de al lado de la USB-C" ;;
      *) listo "el sonido sale por el HDMI, al 100 %, y el volumen se pone en la tele ($SALIDA)" ;;
    esac ;;
  '')
    ojo "no veo ninguna salida de sonido (wpctl status)"
    falta "el sonido. Con la tele encendida y en el HDMI0 (el de al lado de la USB-C), vuelve a lanzar esto" ;;
  *)
    ojo "el sonido sale por $SALIDA, no por el HDMI"
    falta "el sonido. Con la tele encendida y en el HDMI0 (el de al lado de la USB-C), vuelve a lanzar esto" ;;
esac

# ---------- 9. El nombre de la Pi en la red ----------
# El mismo que el de la pantalla. Así se entra con ssh usuario@tele3.local.
if [ "$(hostname)" = "$NOMBRE" ]; then
  ya "la Pi se llama $NOMBRE en la red (${NOMBRE}.local)"
elif printf '%s\n' "$NOMBRE" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'; then
  if sudo raspi-config nonint do_hostname "$NOMBRE"; then
    listo "la Pi pasa a llamarse $NOMBRE en la red (${NOMBRE}.local)"
  else
    ojo "no he podido cambiarle el nombre a la Pi (sigue siendo $(hostname))"
  fi
else
  ojo "la Pi se sigue llamando $(hostname) en la red, porque «${NOMBRE}» no vale como nombre de máquina (solo letras, números y guiones)"
fi

# ---------- 10. overlayroot, para el overlay del final ----------
# raspi-config lo instala con apt al poner el overlay, y en la sala no hay
# internet. Si falla, dice igual que el overlay está puesto. Por eso se baja aquí.
if instalado overlayroot; then
  ya "overlayroot instalado (para el overlay, que va al final)"
elif curl -sfI -o /dev/null --connect-timeout 5 -m 15 http://deb.debian.org/debian/dists/trixie/InRelease; then
  echo "  bajo overlayroot de internet (un par de minutos)…"
  if sudo apt-get -q update >/dev/null && sudo apt-get -q install -y --no-install-recommends overlayroot >/dev/null \
     && instalado overlayroot; then
    listo "overlayroot instalado (para el overlay, que va al final)"
  else
    ojo "no he podido instalar overlayroot"
    falta "instalar overlayroot con internet (sudo apt-get update && sudo apt-get install overlayroot)"
  fi
else
  falta "overlayroot, que necesita internet. Conecta el cable de red y vuelve a lanzar esto (sh $AQUI/preparar.sh)"
fi

if [ "$BOOT_RO" = si ]; then
  sudo mount -o remount,ro "$BOOT" 2>/dev/null || true
fi

# ---------- Lo que queda ----------
echo ""
if [ -n "$FALTA" ]; then
  echo "  falta esto$FALTA"
  echo ""
fi
echo "  y después, por orden"
echo "    reiniciar con sudo reboot, y la tele abrirá $SERVIDOR/screen/$NOMBRE en cuanto el servidor conteste"
echo "    ver cómo está con sh $DESTINO/comprobar.sh"
echo "    la prueba larga y, lo último, el overlay (README.md)"
