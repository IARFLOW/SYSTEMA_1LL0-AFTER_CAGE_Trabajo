#!/bin/sh
# Systema 1LL0~ After Cage · está el Mac listo para quedarse solo varios días?
#
#   sh sala/mac/comprobar.sh
#
# Mira los ajustes que deciden si la sala sigue en marcha sin nadie delante y
# dice de cada uno «ok», «ojo» (hay que arreglarlo) o «mira» (no se puede ver
# desde aquí, o depende de ti). No cambia nada ni pide contraseña. Lo de cada
# cosa, con su porqué, está en sala/mac/README.md.
set -u
ETIQUETA=${1:-es.systema.servidor}
WEB=$(cd "$(dirname "$0")/../.." && pwd -P)
. "$WEB/sala/mac/cortafuegos.sh"
YO=$(id -un)
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
OJOS=0
MIRAS=0
ok() { printf '  ok    %s\n' "$1"; }
ojo() { printf '  ojo   %s\n' "$1"; [ $# -lt 2 ] || printf '        %s\n' "$2"; OJOS=$((OJOS + 1)); }
mira() { printf '  mira  %s\n' "$1"; [ $# -lt 2 ] || printf '        %s\n' "$2"; MIRAS=$((MIRAS + 1)); }
# Un valor de pmset -g custom, del bloque «AC Power» (enchufado) o «Battery Power».
pm() { pmset -g custom 2>/dev/null | awk -v bloque="$1" -v clave="$2" '/^[A-Za-z].*:$/ { dentro = ($0 ~ bloque) } dentro && $1 == clave { print $2; exit }'; }

echo ""
echo "  el Mac de la sala · $(sw_vers -productName) $(sw_vers -productVersion) · $(date '+%d/%m %H:%M')"
echo ""

# ---------- La corriente y la tapa ----------
if pmset -g batt 2>/dev/null | head -1 | grep -q "AC Power"; then ok "enchufado a la corriente"
else ojo "va con la batería" "enchúfalo, que caffeinate solo impide que se duerma estando enchufado (man caffeinate)"; fi

case "$(ioreg -r -k AppleClamshellState -d 4 2>/dev/null | awk -F'= ' '/"AppleClamshellState"/ { print $2; exit }')" in
  No) ok "la tapa está abierta" ;;
  Yes) ojo "la tapa está cerrada" "déjala abierta, porque cerrada el Mac se duerme en cuanto se apagan o se desenchufan las pantallas de fuera" ;;
  *) mira "no sé si la tapa está abierta" "tiene que quedarse abierta (baja el brillo si molesta)" ;;
esac

if [ "$(pm 'AC Power' sleep)" = 0 ]; then ok "enchufado no se duerme solo"
else ojo "enchufado se puede dormir solo" "en Ajustes del Sistema > Batería > Opciones, activa «Impedir que el Mac entre en reposo automáticamente si está conectado a un adaptador de corriente cuando se apaga la pantalla»"; fi

# El modo de energía. En los MacBook Pro con chip Pro o Max de 2024 en
# adelante, que tienen modo de alto rendimiento (Apple, soporte 101613), pmset
# lo llama powermode, con 0 automático, 1 bajo consumo y 2 alto rendimiento. En
# los demás es lowpowermode, con 0 o 1. Leyendo solo el segundo, el M4 Pro de
# Juanlu habría salido «ok» aunque estuviera en bajo consumo.
bajo() {
  v=$(pm "$1" lowpowermode)
  if [ -n "$v" ]; then echo "$v"; return; fi
  case "$(pm "$1" powermode)" in 1) echo 1 ;; 0|2) echo 0 ;; esac
}
LP_AC=$(bajo 'AC Power')
LP_BAT=$(bajo 'Battery Power')
if [ "$LP_AC" = 1 ]; then ojo "modo de bajo consumo con el adaptador" "en Ajustes del Sistema > Batería > Modo de energía, ponlo en Automático"
elif [ "$LP_BAT" = 1 ]; then mira "modo de bajo consumo con la batería" "solo se nota en un corte de luz, pero mejor Automático en los dos (Ajustes del Sistema > Batería)"
elif [ -z "$LP_AC" ]; then mira "no sé en qué modo de energía está" "en Ajustes del Sistema > Batería > Modo de energía, ponlo en Automático con la batería y con el adaptador"
else ok "modo de energía sin bajo consumo"; fi

# ---------- La pantalla, el salvapantallas y la contraseña ----------
# caffeinate -d evita que la pantalla se apague por inactividad mientras el
# servidor está en marcha, pero el salvapantallas y el bloqueo llevan sus
# propios temporizadores (Apple, soporte mh11784).
if [ "$(pm 'AC Power' displaysleep)" = 0 ]; then ok "la pantalla no se apaga con el adaptador"
else mira "la pantalla se apaga sola a los $(pm 'AC Power' displaysleep) min con el adaptador" "mientras el servidor está en marcha no pasa, pero mejor Nunca (Ajustes del Sistema > Pantalla de bloqueo > «Apagar la pantalla cuando el ordenador esté enchufado a la corriente y permanezca inactivo»)"; fi

SALVA=$(defaults -currentHost read com.apple.screensaver idleTime 2>/dev/null || echo "?")
if [ "$SALVA" = 0 ]; then ok "sin salvapantallas"
else ojo "el salvapantallas sale a los $([ "$SALVA" = "?" ] && echo "20 min (lo de fábrica)" || echo "$((SALVA / 60)) min")" "tapa lo que pone Max. En Ajustes del Sistema > Pantalla de bloqueo, pon «Iniciar el salvapantallas cuando el ordenador esté inactivo» en Nunca"; fi

# sysadminctl dice «screenLock is off» con Nunca, y «screenLock delay is
# immediate» o «… is 5 seconds» si la pide (lo que escribe el programa).
BLOQUEO=$(sysadminctl -screenLock status 2>&1)
SOLICITAR="en Ajustes del Sistema > Pantalla de bloqueo, pon «Solicitar la contraseña después de que se inicie el salvapantallas o se apague la pantalla»"
case "$BLOQUEO" in
  *"screenLock is off"*) ok "no pide contraseña al volver del salvapantallas o de la pantalla apagada" ;;
  *"delay is "*)
    CUANDO=$(printf '%s\n' "$BLOQUEO" | sed -n 's/.*screenLock delay is //p' | head -n 1)
    case "$CUANDO" in
      immediate) CUANDO="al momento" ;;
      *" seconds") CUANDO="a los ${CUANDO% seconds} s" ;;
    esac
    ojo "pide contraseña al volver ($CUANDO)" "$SOLICITAR en Nunca. Con el Mac bloqueado 3 días, un accesorio que se desenchufe puede no volver (Apple, soporte 102282)" ;;
  *) mira "no sé si pide contraseña al volver" "$SOLICITAR en Nunca, si te deja" ;;
esac

# ---------- Después de un reinicio ----------
# El servidor y Max solo arrancan con la sesión iniciada. Con FileVault, tras
# un reinicio el Mac se queda pidiendo la contraseña (Apple, soporte mchlp1158).
AUTO=$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)
if fdesetup isactive >/dev/null 2>&1; then
  ojo "FileVault está activado" "tras un reinicio (un corte largo, un fallo) nada arranca hasta que alguien escriba la contraseña. O lo desactivas durante la expo y pones el inicio de sesión automático, o quien abra la sala cada día tiene la contraseña"
elif [ "$AUTO" = "$YO" ]; then ok "FileVault desactivado e inicio de sesión automático en $YO"
else ojo "no inicia sesión solo" "en Ajustes del Sistema > Usuarios y grupos, pon $YO en «Iniciar sesión automáticamente como». Sin eso, tras un reinicio no arranca nada"; fi

# ---------- El cortafuegos ----------
NODE=$(command -v node 2>/dev/null || true)
[ -z "$NODE" ] || NODE=$(node -p 'process.execPath' 2>/dev/null || echo "$NODE")
if ! fw_activado; then ok "cortafuegos apagado (deja entrar a los móviles)"
else
  if fw_bloquea_todo; then ojo "el cortafuegos bloquea todas las conexiones entrantes" "así no entra ningún móvil. Vuelve a lanzar sh sala/mac/instalar.sh, que lo arregla"; fi
  case "$(fw_en_lista "${NODE:-node}")" in
    si) ok "cortafuegos activado, y node está entre los permitidos" ;;
    no) ojo "el cortafuegos bloquea a node" "vuelve a lanzar sh sala/mac/instalar.sh, que lo arregla" ;;
    *)
      if fw_firmado_y_permitido "${NODE:-node}"; then ok "cortafuegos activado, y deja entrar a node porque va firmado"
      else ojo "el cortafuegos está activado y no deja entrar a node" "la primera vez que entre un móvil, macOS preguntará en pantalla y no dejará pasar a nadie hasta que alguien conteste. Vuelve a lanzar sh sala/mac/instalar.sh, que lo arregla"; fi ;;
  esac
  if fw_encubierto; then mira "modo encubierto del cortafuegos activado" "los iPhone tardan unos 3 s más en abrir la web la primera vez. Para quitarlo, lanza sudo $FW --setstealthmode off"; fi
fi

# ---------- El servicio y el servidor ----------
if [ ! -f "$PLIST" ]; then ojo "el servidor no está instalado" "sh sala/mac/instalar.sh"
else
  PUERTO=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:PORT' "$PLIST" 2>/dev/null || echo 80)
  INFO=$(launchctl print "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true)
  if [ -z "$INFO" ]; then ojo "instalado pero no cargado" "mira en Ajustes del Sistema > General > Ítems de inicio y extensiones que «caffeinate» esté permitido en segundo plano, y vuelve a lanzar sh sala/mac/instalar.sh"
  elif printf '%s' "$INFO" | grep -q 'state = running'; then ok "el servicio está en marcha"
  else ojo "el servicio está cargado pero no en marcha" "mira el registro con sh sala/mac/estado.sh"; fi
  SALUD=$(curl -s -m 2 "http://127.0.0.1:$PUERTO/health" 2>/dev/null || true)
  case "$SALUD" in
    ok*)
      ok "el servidor contesta en el puerto $PUERTO"
      if printf '%s\n' "$SALUD" | grep -q '^osc SIN PUERTO\|^osc ERROR'; then ojo "el servidor no escucha a Max" "$(printf '%s\n' "$SALUD" | sed -n 's/^osc //p')"; fi
      FALTAN=$(printf '%s\n' "$SALUD" | sed -n 's/^missing //p')
      case "$FALTAN" in
        ""|-) [ "$(printf '%s\n' "$SALUD" | sed -n 's/^expected //p')" = "-" ] || ok "todas las pantallas de la lista tienen su página abierta" ;;
        *) mira "hay pantallas sin su página abierta ($FALTAN)" "si la sala está encendida, míralas en el panel, en http://localhost$([ "$PUERTO" = 80 ] || echo ":$PUERTO")/panel" ;;
      esac ;;
    *) ojo "el servidor no contesta en el puerto $PUERTO" "sh sala/mac/estado.sh dice qué ha pasado" ;;
  esac
fi

# ---------- Las pantallas por cable ----------
# Nunca «ojo», que hay ordenadores sin pantallas por cable y este script sale
# con error si hay alguno. El servicio es el de sala/pantallas/mac.sh --instalar.
PANTALLAS_PLIST="$HOME/Library/LaunchAgents/es.systema.pantallas.plist"
if [ -f "$PANTALLAS_PLIST" ] && launchctl print "gui/$(id -u)/es.systema.pantallas" >/dev/null 2>&1; then
  ok "las pantallas de este Mac se abren solas"
else
  mira "las pantallas por cable de este Mac no se abrirán solas tras un reinicio" "si lleva alguna, en la carpeta web, sh sala/pantallas/mac.sh --instalar tele1 tele2, con sus nombres (y --servidor con la IP del M4 si este no es el M4). Lo cuenta sala/pantallas/README.md"
fi

# ---------- La red ----------
IFAZ=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }' || true)
if [ -z "$IFAZ" ]; then mira "no tiene red" "conéctalo a la red de la sala (mejor por cable, con el adaptador)"
else
  IP=$(ipconfig getifaddr "$IFAZ" 2>/dev/null || true)
  PUERTO_HW=$(networksetup -listallhardwareports 2>/dev/null | awk -v i="$IFAZ" '/^Hardware Port:/ { p = substr($0, 16) } /^Device:/ && $2 == i { print p; exit }')
  case "$PUERTO_HW" in
    Wi-Fi)
      REAL=$(networksetup -getmacaddress "$IFAZ" 2>/dev/null | awk '{ print $3 }')
      AHORA=$(ifconfig "$IFAZ" 2>/dev/null | awk '/ether/ { print $2; exit }')
      if [ -n "$REAL" ] && [ -n "$AHORA" ] && [ "$REAL" != "$AHORA" ]; then
        mira "va por Wi-Fi con una dirección Wi-Fi privada (IP ${IP:-?})" "en la red de la sala, «Dirección Wi-Fi privada» en Fija o Desactivada antes de reservar la IP en el router, y no olvides esa red después (Apple, soporte 102509). Por cable no hace falta"
      else mira "va por Wi-Fi (IP ${IP:-?})" "mejor por cable al router, con el adaptador, porque así la IP no cambia y no compite con los móviles"; fi ;;
    *) ok "va por cable ($PUERTO_HW, IP ${IP:-?})" ;;
  esac
fi

# ---------- Actualizaciones ----------
# Sin internet no se instala nada (Apple, Platform Security). El riesgo está
# antes, mientras el Mac tiene internet, y es que se actualice solo y se pruebe
# todo en un sistema distinto del que va a la sala.
SU=/Library/Preferences/com.apple.SoftwareUpdate
if [ "$(defaults read $SU AutomaticallyInstallMacOSUpdates 2>/dev/null || echo 0)" = 1 ]; then
  ojo "macOS se actualiza solo" "en Ajustes del Sistema > General > Actualización de software > Actualizaciones automáticas, apágalas hasta después de la expo"
else ok "macOS no se actualiza solo"; fi
PENDIENTE=$(defaults read $SU AutoInstallProductKeys 2>/dev/null | tr -d ' ()"\n' || true)
[ -z "$PENDIENTE" ] || mira "hay una actualización preparada para instalarse ($PENDIENTE)" "instálala con tiempo para volver a probarlo todo, o no le des a «Intentar esta noche». Y nada de pasar a macOS 27 antes de la expo"

# ---------- Lo que no se ve desde aquí ----------
mira "accesorios" "en Ajustes del Sistema > Privacidad y seguridad, pon «Permitir que se conecten los accesorios» en Permitir siempre"
mira "el patch de Max al iniciar sesión" "en Ajustes del Sistema > General > Ítems de inicio y extensiones, añade el .maxpat a «Abrir al iniciar sesión»"
mira "la licencia de Max" "ábrelo con internet los días antes del montaje, que la suscripción mensual pide conectarse cada 30 días"
mira "Max sin dormirse" "en el montaje, abre Monitor de Actividad > Energía y mira la columna App Nap. Max tiene que salir con «No»"

echo ""
if [ $OJOS = 0 ]; then echo "  nada que arreglar, y $MIRAS cosas que mirar a mano"
else echo "  $OJOS cosas que arreglar y $MIRAS que mirar a mano"; fi
echo ""
[ $OJOS = 0 ]
