#!/bin/sh
# Systema 1LL0~ After Cage · que el servidor arranque solo en el Mac de la sala
#
#   sh sala/mac/instalar.sh                  lo instala y lo arranca, con la web en el 80 y Max en el 9100
#   sh sala/mac/instalar.sh --puerto 8080    con la web en otro puerto (para probarlo en casa)
#   sh sala/mac/instalar.sh --pantallas tele1,tele2,monitor1,monitor2,proyector1,proyector2
#                                            las pantallas de la sala, con el nombre que usa Max,
#                                            y el panel dirá cuál falta aunque no se haya encendido
#   sh sala/mac/instalar.sh --clave-panel unaclavelarga
#                                            para abrir el panel desde otro aparato de la red
#                                            (http://<el mac>/panel?clave=unaclavelarga)
#
# Deja un servicio de macOS (un LaunchAgent de este usuario) que arranca el
# servidor cada vez que se inicia sesión, lo vuelve a levantar si se cae, y
# mientras está en marcha no deja que el Mac se duerma ni que se apaguen sus
# pantallas (caffeinate). Lo que cuenta el servidor va a ~/Library/Logs/Systema/.
# Si el cortafuegos del Mac está activado, deja a node entre los permitidos
# (para eso pide la contraseña del Mac).
#
#   sh sala/mac/estado.sh        cómo va
#   sh sala/mac/comprobar.sh     si el Mac está listo para quedarse solo varios días
#   sh sala/mac/desinstalar.sh   quitarlo
#
# Volver a lanzarlo es seguro, porque para el que hubiera y pone el nuevo. La lista
# de pantallas y la clave del panel se quedan como estaban si no se dicen.
set -eu

# Con tu usuario, nunca con sudo delante. El servicio vive con tu sesión y el
# puerto 80 no necesita permisos de administrador. Lanzado como root, dejaba en
# tu carpeta ficheros de root que luego no se podían cambiar (visto el
# 2-oct-2026). Si hace falta la contraseña (el cortafuegos), se pide sola.
if [ "$(id -u)" = 0 ]; then
  echo "lánzalo sin sudo delante, con sh sala/mac/instalar.sh (si hace falta la contraseña, ya te la pido yo)"
  exit 1
fi

ETIQUETA=es.systema.servidor
PUERTO=80
OSC=9100
PANTALLAS=""
PANTALLAS_DADAS=0
CLAVE=""
CLAVE_DADA=0
while [ $# -gt 0 ]; do
  case "$1" in
    --puerto) PUERTO="${2:?falta el número de puerto}"; shift 2 ;;
    --osc) OSC="${2:?falta el número de puerto}"; shift 2 ;;
    --etiqueta) ETIQUETA="${2:?falta la etiqueta}"; shift 2 ;;   # para probar sin pisar el de verdad
    --pantallas)
      [ $# -ge 2 ] || { echo "falta la lista, por ejemplo --pantallas tele1,tele2" >&2; exit 1; }
      PANTALLAS=$2; PANTALLAS_DADAS=1; shift 2 ;;
    --clave-panel)
      [ $# -ge 2 ] || { echo "falta la clave, por ejemplo --clave-panel unaclavelarga" >&2; exit 1; }
      CLAVE=$2; CLAVE_DADA=1; shift 2 ;;
    *) echo "no conozco la opción $1" >&2; exit 1 ;;
  esac
done

# pwd -P da la ruta de verdad. Con un enlace (~/Systema apuntando al
# Escritorio), la guarda de más abajo lo dejaría pasar y macOS no.
WEB=$(cd "$(dirname "$0")/../.." && pwd -P)
YO=$(id -u)
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
LOGS="$HOME/Library/Logs/Systema"
if [ "$ETIQUETA" = es.systema.servidor ]; then LOG="$LOGS/servidor.log"; else LOG="$LOGS/$ETIQUETA.log"; fi
. "$WEB/sala/mac/cortafuegos.sh"

# Lo que no se diga se queda como en la instalación anterior.
anterior() {
  [ -f "$PLIST" ] || return 0
  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$1" "$PLIST" 2>/dev/null || true
}
[ "$PANTALLAS_DADAS" = 1 ] || PANTALLAS=$(anterior PANTALLAS)
[ "$CLAVE_DADA" = 1 ] || CLAVE=$(anterior PANEL_CLAVE)

# La lista, en minúsculas y separada por comas, como la entiende el servidor,
# y cada nombre como los de Max (/tele1/video), con letras, números, _ y -.
PANTALLAS=$(printf '%s' "$PANTALLAS" | tr 'A-Z' 'a-z' | tr -s ' ,;' '\n' | sed '/^$/d' | paste -sd, - || true)
MALA=$(printf '%s' "$PANTALLAS" | awk -F, '{ for (i = 1; i <= NF; i++) if ($i !~ /^[a-z0-9_-]+$/ || length($i) > 32) { print $i; exit } }')
if [ -n "$MALA" ]; then
  echo "«${MALA}» no vale como nombre de pantalla. Solo letras sin tilde, números, _ y -, y el mismo que usa Max (/tele1/video)"
  exit 1
fi
# La clave va en la dirección (?clave=…) y la puede probar cualquiera que esté
# en la Wi-Fi de la sala. Por eso larga, y sin caracteres que haya que escapar.
if [ -n "$CLAVE" ]; then
  case "$CLAVE" in
    *[!A-Za-z0-9_-]*) echo "la clave del panel solo puede llevar letras sin tilde, números, _ y -"; exit 1 ;;
  esac
  if [ "${#CLAVE}" -lt 12 ]; then echo "la clave del panel tiene que tener 12 caracteres como poco"; exit 1; fi
fi

# ---------- Lo que hace falta antes ----------
NODE=$(command -v node || true)
if [ -z "$NODE" ]; then
  echo "falta Node. Se baja de https://nodejs.org (la versión LTS) y se instala como cualquier programa"
  exit 1
fi
# node-osc pide Node 22.11 o más nuevo (o el 24), y con uno anterior no arranca.
if ! "$NODE" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 11) ? 0 : 1)'; then
  echo "este Node es el $("$NODE" -v) y hace falta el 22.11 o más nuevo, el LTS de https://nodejs.org"
  exit 1
fi
# La ruta de verdad del programa, sin enlaces, que es la que tiene que ir en la
# lista del cortafuegos (el de Homebrew es un enlace a otra carpeta).
NODE=$("$NODE" -p 'process.execPath')
[ -f "$WEB/server/index.js" ] || { echo "no encuentro $WEB/server/index.js"; exit 1; }
[ -d "$WEB/node_modules/express" ] || { echo "faltan las dependencias, haz npm ci en $WEB"; exit 1; }

# macOS no deja que un servicio lea el Escritorio, Documentos, Descargas,
# iCloud ni un disco externo sin un permiso que se pide en pantalla. Con nadie
# delante, el servidor no arrancaría. La carpeta tiene que estar fuera.
case "$WEB/" in
  "$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Downloads/"*|"$HOME/Library/Mobile Documents/"*|/Volumes/*)
    echo "la web está en $WEB"
    echo "macOS no deja que un servicio lea el Escritorio, Documentos, Descargas, iCloud ni un disco externo"
    echo "sin un permiso que se pide en pantalla, y con nadie delante el servidor no arrancaría."
    echo "mueve la carpeta a tu carpeta de usuario, por ejemplo con"
    echo "  mv \"$(dirname "$WEB")\" ~/Systema"
    echo "y vuelve a lanzar esto desde allí."
    exit 1 ;;
esac

# ---------- El cortafuegos ----------
# Va antes de arrancar el servicio. Así, si macOS fuera a preguntar al ponerse a
# escuchar, ya no pregunta. Se arregla aquí, con alguien delante, y se
# comprueba mirando la lista, no fiándose de lo que conteste sudo.
cortafuegos() {
  fw_activado || return 0
  falta_node=0; falta_todo=0
  fw_deja_entrar "$NODE" || falta_node=1
  if fw_bloquea_todo; then falta_todo=1; fi
  if [ $falta_node = 0 ] && [ $falta_todo = 0 ]; then
    echo "el cortafuegos está activado y deja entrar a node"
  else
    echo "el cortafuegos de este Mac está activado y no dejaría entrar a los móviles."
    [ $falta_node = 0 ] || echo "  · node no está entre los programas que pueden recibir conexiones ($NODE)"
    [ $falta_todo = 0 ] || echo "  · está puesto «bloquear todas las conexiones entrantes», y así no entra nadie"
    if [ -t 0 ]; then
      echo "lo arreglo ahora, con la contraseña de este Mac."
      pide='  escribe la contraseña de este Mac, que no sale en pantalla '
      if [ $falta_node = 1 ]; then
        sudo -p "$pide" "$FW" --add "$NODE" >/dev/null || true
        sudo -p "$pide" "$FW" --unblockapp "$NODE" >/dev/null || true
      fi
      [ $falta_todo = 0 ] || sudo -p "$pide" "$FW" --setblockall off >/dev/null || true
    fi
    if fw_deja_entrar "$NODE" && ! fw_bloquea_todo; then
      echo "el cortafuegos ya está arreglado y node puede recibir conexiones"
    else
      echo ""
      echo "  ojo, el cortafuegos sigue sin dejar entrar a los móviles. Arréglalo en la Terminal con"
      echo "  estos comandos, que piden la contraseña del Mac, y vuelve a lanzar esto."
      echo "    sudo $FW --add \"$NODE\""
      echo "    sudo $FW --unblockapp \"$NODE\""
      if fw_bloquea_todo; then echo "    sudo $FW --setblockall off"; fi
      echo "  o en Ajustes del Sistema > Red > Firewall > Opciones, añade node (Cmd+Mayús+G y pega"
      echo "  la ruta de arriba) con «Permitir las conexiones entrantes»."
      echo ""
    fi
  fi
  # No lo cambio yo, que es un ajuste de seguridad del Mac. Solo lo digo.
  if fw_encubierto; then
    echo "  el modo encubierto del cortafuegos está activado, y los iPhone tardarán unos 3 s más en abrir"
    echo "  la web la primera vez. Para quitarlo durante la expo, lanza sudo $FW --setstealthmode off"
  fi
}
cortafuegos

# El node de nodejs.org va firmado por sus autores. Uno sin firma (el de
# Homebrew) también funciona, pero el permiso del cortafuegos y el servicio
# van con su ruta, que cambia en cada actualización.
if codesign -dv "$NODE" 2>&1 | grep -q 'TeamIdentifier=not set'; then
  echo "ojo, este node no es el de nodejs.org. Funciona, pero si lo actualizas hay que volver a lanzar esto."
fi

# Si ya había uno, se para antes de cambiarlo.
launchctl bootout "gui/$YO/$ETIQUETA" 2>/dev/null || true
sleep 1

if lsof -nP -iTCP:"$PUERTO" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "el puerto $PUERTO ya lo tiene otro programa."
  lsof -nP -iTCP:"$PUERTO" -sTCP:LISTEN | sed 1d | awk '{ print "  " $1 " (pid " $2 ")" }'
  echo "ciérralo y vuelve a lanzar esto, o usa otro puerto con --puerto"
  exit 1
fi

# ---------- El servicio ----------
mkdir -p "$HOME/Library/LaunchAgents" "$LOGS"
# Si el registro ha crecido mucho, el anterior se guarda aparte.
if [ -f "$LOG" ] && [ "$(stat -f %z "$LOG")" -gt 20000000 ]; then
  mv "$LOG" "$LOG.$(date +%Y%m%d-%H%M%S)"
fi

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
variable() { [ -z "$2" ] || printf '    <key>%s</key>\n    <string>%s</string>\n' "$1" "$(xml "$2")"; }

# Con caffeinate -d la pantalla no se apaga por inactividad, con -i y -s el Mac
# no se duerme (con -s, solo enchufado) y con -m el disco tampoco. Con la tapa
# cerrada se duerme igual, y el salvapantallas y el bloqueo van aparte
# (man caffeinate). Eso lo mira comprobar.sh.
# Con KeepAlive, si el servidor se cae, launchd lo vuelve a levantar a los 5 s.
# ProcessType Interactive, para que macOS no lo frene por ir en segundo plano.
# NumberOfFiles, porque launchd deja 256 ficheros abiertos por defecto, y cada
# móvil y cada pantalla es una conexión. Sin tope duro, porque Node sube él solo
# su límite hasta el que deja macOS (61 440 en este Mac, medido el 2-oct-2026).
# Con un tope duro de 4096, un solo portátil con un script lo agotaba y el
# servidor dejaba de servir páginas y vídeos a todo el mundo.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml "$ETIQUETA")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-dims</string>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$WEB/server/index.js")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml "$WEB")</string>
  <key>EnvironmentVariables</key>
  <dict>
$(variable PORT "$PUERTO")
$(variable OSC_PORT "$OSC")
$(variable PANTALLAS "$PANTALLAS")
$(variable PANEL_CLAVE "$CLAVE")
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>SoftResourceLimits</key>
  <dict>
    <key>NumberOfFiles</key>
    <integer>4096</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null

launchctl enable "gui/$YO/$ETIQUETA" 2>/dev/null || true
if ! launchctl bootstrap "gui/$YO" "$PLIST"; then
  echo "macOS no ha dejado arrancar el servicio. Mira en Ajustes del Sistema > General > Ítems de inicio"
  echo "y extensiones que «caffeinate» esté activado, y vuelve a lanzar esto, sin sudo delante."
  exit 1
fi

# ---------- Que responda ----------
i=0
until curl -s -m 1 "http://127.0.0.1:$PUERTO/health" 2>/dev/null | head -1 | grep -q '^ok'; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "el servidor no responde en el puerto $PUERTO. Esto es lo último que ha dicho."
    tail -n 20 "$LOG" | sed 's/^/  /'
    exit 1
  fi
  sleep 0.25
done

# La IP de la red por la que sale el Mac (la Wi-Fi o el adaptador de cable).
IFAZ=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }' || true)
IP=$( { [ -n "$IFAZ" ] && ipconfig getifaddr "$IFAZ"; } 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
SUFIJO=""
[ "$PUERTO" = 80 ] || SUFIJO=":$PUERTO"
echo ""
echo "  listo, el servidor arranca solo cada vez que se inicia sesión en este usuario"
echo ""
echo "  web del público   http://systema.internal$SUFIJO/  (con el router de la sala)"
[ -z "$IP" ] || echo "                    http://$IP$SUFIJO/"
echo "  pantallas         http://<esta dirección>$SUFIJO/screen/tele1, tele2…"
[ -z "$PANTALLAS" ] || echo "  las de la sala    $(printf '%s' "$PANTALLAS" | sed 's/,/, /g')  (el panel dice cuál falta)"
echo "  panel de la sala  http://localhost$SUFIJO/panel"
[ -z "$CLAVE" ] || [ -z "$IP" ] || echo "                    http://$IP$SUFIJO/panel?clave=$CLAVE  (desde otro aparato)"
echo "  Max               OSC a 127.0.0.1, puerto $OSC"
echo "  registro          $LOG"
echo ""
echo "  el servicio vive con la sesión. Si el Mac se reinicia, hay que entrar en este"
echo "  usuario para que arranque. Y la tapa, abierta, que cerrada el Mac se duerme"
echo "  aunque esto esté en marcha, en cuanto se apagan las pantallas de fuera."
echo "  lo demás para dejarlo solo varios días lo mira sh sala/mac/comprobar.sh"
