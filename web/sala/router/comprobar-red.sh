#!/bin/sh
# Systema 1LL0~ After Cage · está bien la red de la sala? Visto desde el Mac del servidor
#
#   sh sala/router/comprobar-red.sh                    en la sala, con la web en el 80
#   sh sala/router/comprobar-red.sh --puerto 8090      con el servidor en otro puerto (para probarlo en casa)
#   sh sala/router/comprobar-red.sh --dns 192.168.1.1  pregunta a ese DNS y no al que reparte el router
#
# Dice de cada cosa «ok», «ojo» (hay que arreglarlo) o «mira» (no se puede ver
# desde aquí, o depende de ti). No cambia nada ni pide contraseña. Mira estas cosas.
#   · que systema.internal lleva a este Mac, preguntando al DNS que reparte el
#     router, que es al que preguntan los móviles
#   · que la web contesta por la IP y por el nombre
#   · que la comprobación de los iPhone (captive.apple.com) llega a este Mac y
#     recibe «Success»
#   · la banda y el canal de la Wi-Fi, y la dirección que va en la reserva
#   · qué hay que poner en los carteles
# Lo que ve un móvil no se puede mirar desde aquí, y se prueba con un móvil
# (sala/router/README.md, «Desde un iPhone y un Android»). El cortafuegos y el
# resto del Mac, con sh sala/mac/comprobar.sh.
set -u

NOMBRE=systema.internal
APPLE=captive.apple.com
ANDROID=connectivitycheck.gstatic.com
PUERTO=80
DNS=""
DNS_DADO=""
# Solo para las pruebas, con un DNS de mentira en otro puerto.
DNS_PUERTO=${DNS_PUERTO:-53}
while [ $# -gt 0 ]; do
  case "$1" in
    --puerto) PUERTO="${2:?falta el número de puerto}"; shift 2 ;;
    --dns) DNS="${2:?falta la IP del DNS}"; DNS_DADO=si; shift 2 ;;
    *) echo "no conozco la opción $1" >&2; exit 1 ;;
  esac
done
case "$PUERTO" in ''|*[!0-9]*) echo "el puerto es un número, por ejemplo --puerto 8090" >&2; exit 1 ;; esac

OJOS=0
MIRAS=0
# ok|ojo|mira <lo que pasa> [<qué hacer>…], y cada línea de más va debajo.
di() { printf '  %-5s %s\n' "$1" "$2"; shift 2; for l in "$@"; do printf '        %s\n' "${l}"; done; }
ok() { di ok "$@"; }
ojo() { OJOS=$((OJOS + 1)); di ojo "$@"; }
mira() { MIRAS=$((MIRAS + 1)); di mira "$@"; }

# Las IP de este Mac, una por línea, como «interfaz ip máscara» (sin 127.x ni 169.254.x).
PARES=$(ifconfig 2>/dev/null | awk '/^[a-z]/ { i = $1; sub(/:$/, "", i) } $1 == "inet" && $2 !~ /^127\./ && $2 !~ /^169\.254\./ { print i, $2, $4 }')
if [ -z "$PARES" ]; then
  echo "este Mac no tiene red, ni una sola IP. Únelo a la Wi-Fi de la sala o conéctalo al router por cable."
  exit 1
fi
es_mia() { printf '%s\n' "$PARES" | awk -v ip="$1" '$2 == ip { e = 1 } END { exit !e }'; }
# dato <interfaz o IP> <columna>, con 1 la interfaz, 2 la IP y 3 la máscara.
dato() { printf '%s\n' "$PARES" | awk -v k="$1" -v c="$2" '$1 == k || $2 == k { print $c; exit }'; }
privada() { case "$1" in 10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;; *) return 1 ;; esac; }
# misma_red <ip> <ip> <máscara en hex, como la da ifconfig (0xffffff00)>
misma_red() {
  awk -v a="$1" -v b="$2" -v m="$3" 'function n(x,  p) { split(x, p, "."); return ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4] }
    BEGIN {
      h = tolower(substr(m, 3)); k = 0
      for (j = 1; j <= length(h); j++) k = k * 16 + index("0123456789abcdef", substr(h, j, 1)) - 1
      t = 4294967296 - k
      exit !(t > 0 && int(n(a) / t) == int(n(b) / t))
    }'
}

# El DNS que reparte el router (el de los móviles), salvo que se diga otro.
SALIDA=$(route -n get default 2>/dev/null | awk '$1 == "interface:" { print $2 }')
DNS_DE=""
if [ -z "$DNS" ]; then
  for i in $SALIDA $(printf '%s\n' "$PARES" | awk '{ print $1 }'); do
    DNS=$(ipconfig getoption "$i" domain_name_server 2>/dev/null || true)
    if [ -n "$DNS" ]; then DNS_DE=$i; break; fi
  done
fi

# pregunta <nombre> deja en RESP las IP que da el DNS (una por línea) y en
# ESTADO «si» (las da), «no» (no lo conoce), «mudo» (no contesta) o «sin» (no
# hay a quién preguntar).
pregunta() {
  RESP=""
  if [ -z "$DNS" ] || ! command -v dig >/dev/null 2>&1; then ESTADO=sin; return; fi
  if ! s=$(dig +time=2 +tries=1 +noall +comments +answer -p "$DNS_PUERTO" A "$1" "@${DNS}" 2>/dev/null); then ESTADO=mudo; return; fi
  RESP=$(printf '%s\n' "$s" | awk '!/^;/ && $4 == "A" { print $5 }')
  if [ -n "$RESP" ]; then ESTADO=si; else ESTADO=no; fi
}

pregunta "$NOMBRE"
NOMBRE_ESTADO=$ESTADO
NOMBRE_IPS=$(printf '%s\n' "$RESP" | awk 'NF { printf "%s%s", s, $1; s = ", " }')
IP=""
for a in $RESP; do
  if es_mia "$a"; then IP=$a; break; fi
done
NOMBRE_MIO=$IP
# Si el nombre no lleva aquí, la IP de la conexión principal de este Mac.
if [ -z "$IP" ] && [ -n "$SALIDA" ]; then IP=$(dato "$SALIDA" 2); fi
if [ -z "$IP" ]; then IP=$(printf '%s\n' "$PARES" | awk 'NR == 1 { print $2 }'); fi
IF=$(dato "$IP" 1)
MASCARA=$(dato "$IP" 3)
PUERTA=$(ipconfig getoption "$IF" router 2>/dev/null || true)
SUF=""
[ "$PUERTO" = 80 ] || SUF=":${PUERTO}"

# La Wi-Fi tarda unos segundos en contestar, así que se le pregunta ya, en paralelo,
# si es la de la sala (la misma conexión o la misma red que la IP de arriba).
TMP=$(mktemp -d "${TMPDIR:-/tmp}/comprobar-red.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
WIFI=$(networksetup -listallhardwareports 2>/dev/null | awk '/^Hardware Port: Wi-Fi$/ { getline; print $2; exit }')
WIFI_IP=""
PERFIL=""
[ -z "$WIFI" ] || WIFI_IP=$(dato "$WIFI" 2)
if [ -n "$WIFI_IP" ] && { [ "$WIFI" = "$IF" ] || misma_red "$WIFI_IP" "$IP" "$MASCARA"; }; then
  system_profiler -xml SPAirPortDataType > "$TMP/wifi.plist" 2>/dev/null &
  PERFIL=$!
fi

echo ""
if [ "$PUERTO" = 80 ]; then echo "  la red de la sala, vista desde este Mac · $(date '+%d/%m %H:%M')"
else echo "  la red de la sala, vista desde este Mac · $(date '+%d/%m %H:%M') · web en el ${PUERTO} (en la sala va en el 80)"; fi
echo ""

# ---------- El nombre ----------
if [ -n "$DNS_DADO" ]; then QUIEN="el DNS ${DNS}"; else QUIEN="el DNS del router (${DNS})"; fi
case "$NOMBRE_ESTADO" in
  si)
    if [ -n "$NOMBRE_MIO" ]; then
      if [ -n "$DNS_DADO" ]; then ok "${NOMBRE} lleva a ${NOMBRE_MIO}, que es este Mac (lo dice ${QUIEN})"
      else ok "${NOMBRE} lleva a ${NOMBRE_MIO}, que es este Mac" "(lo dice ${QUIEN}, el mismo al que preguntan los móviles)"; fi
    else
      ojo "${NOMBRE} lleva a ${NOMBRE_IPS}, y este Mac es ${IP}" "en el router, que el nombre apunte a la IP reservada de este Mac"
    fi ;;
  # Contesta y no lo conoce. Con un router que no da nombres, como el AX53 de
  # la sala, es lo normal y no hay nada que arreglar.
  no) mira "el router no da nombres, ${QUIEN} no conoce ${NOMBRE}" "es lo normal con el vuestro, y los carteles van con la IP (abajo)" ;;
  mudo)
    if [ -z "$DNS_DADO" ] && [ -n "$PUERTA" ] && [ "$PUERTA" != "$DNS" ]; then
      ojo "el DNS que reparte el router (${DNS}) no contesta" "no es el router (${PUERTA}). En su DHCP, que reparta como DNS su propia IP"
    else
      ojo "${QUIEN} no contesta"
    fi ;;
  sin)
    if ! command -v dig >/dev/null 2>&1; then ojo "falta dig, que viene con macOS, y sin él no puedo preguntar al DNS del router"
    else ojo "no sé a qué DNS preguntan los móviles, porque este Mac no ha recibido la IP del router" "prueba con --dns y la IP del router"; fi ;;
esac

# Si reparte más de un DNS, sin internet el de fuera no contesta, y algún
# móvil le podría preguntar a él.
if [ -n "$DNS_DE" ]; then
  TODOS=$(ipconfig getpacket "$DNS_DE" 2>/dev/null | sed -n 's/^domain_name_server (ip_mult): {\(.*\)}$/\1/p')
  case "$TODOS" in
    *,*) mira "el router reparte más de un DNS (${TODOS})" "mejor uno solo, el del propio router, porque sin internet los de fuera no contestan" ;;
  esac
fi

# ---------- La web ----------
WEB_IP=""
R=$(curl -s -m 4 --noproxy '*' "http://${IP}${SUF}/health" 2>/dev/null)
RC=$?
if [ "$RC" -eq 0 ] && [ "$(printf '%s\n' "$R" | head -n 1)" = ok ]; then
  ok "la web contesta por la IP, en http://${IP}${SUF}/"
  WEB_IP=si
elif [ "$RC" -eq 7 ]; then
  ojo "nadie contesta en http://${IP}${SUF}/" "está el servidor en marcha? sh sala/mac/estado.sh"
elif [ "$RC" -eq 28 ]; then
  ojo "http://${IP}${SUF}/ no contesta a tiempo" "sh sala/mac/estado.sh"
else
  ojo "en http://${IP}${SUF}/ contesta otra cosa, no el servidor de la sala" "tiene otro programa el puerto ${PUERTO}? lsof -nP -iTCP:${PUERTO} -sTCP:LISTEN"
fi

# Por el nombre, como lo abriría un navegador de este Mac.
R=$(curl -s -m 5 --noproxy '*' -w '\n%{remote_ip}' "http://${NOMBRE}${SUF}/health" 2>/dev/null)
RC=$?
CUERPO=$(printf '%s\n' "$R" | head -n 1)
DESTINO=$(printf '%s\n' "$R" | tail -n 1)
if [ "$RC" -eq 0 ] && [ "$CUERPO" = ok ] && es_mia "$DESTINO"; then
  ok "la web contesta por el nombre, en http://${NOMBRE}${SUF}/"
elif [ "$RC" -eq 6 ]; then
  # Este Mac no lo encuentra. Si el router tampoco, ya está dicho arriba.
  [ -z "$NOMBRE_MIO" ] || ojo "este Mac no encuentra ${NOMBRE}, aunque ${QUIEN} sí" "tiene un DNS puesto a mano? Ajustes del Sistema > Red > (la conexión) > Detalles > DNS" "a los móviles no les afecta"
elif [ "$RC" -eq 0 ] && [ "$CUERPO" = ok ]; then
  ojo "este Mac abre ${NOMBRE} en ${DESTINO}, no en ${IP}" "los móviles irán a donde diga el router, no a donde va este Mac"
elif [ "$DESTINO" = "$IP" ] && [ -z "$WEB_IP" ]; then
  : # Lleva a la IP de arriba, donde ya se ha dicho que no contesta el servidor.
else
  ojo "${NOMBRE} no abre la web desde este Mac" "lleva a ${DESTINO:-ninguna parte}, y allí no contesta el servidor de la sala"
fi
if grep -v '^[[:space:]]*#' /etc/hosts 2>/dev/null | grep -qiF "$NOMBRE"; then
  ojo "este Mac tiene ${NOMBRE} en /etc/hosts" "así lo encuentra aunque el router no lo sepa, y los móviles no lo ven. Quítalo de ahí"
fi

# ---------- Las comprobaciones de los móviles ----------
pregunta "$APPLE"
case "$ESTADO" in
  si)
    AQUI=""
    for a in $RESP; do
      if es_mia "$a"; then AQUI=$a; break; fi
    done
    if [ -n "$AQUI" ]; then
      # Por su nombre, y a la IP que da el router, como lo pediría un iPhone.
      B=$(curl -s -m 4 --noproxy '*' --resolve "${APPLE}:${PUERTO}:${AQUI}" "http://${APPLE}${SUF}/hotspot-detect.html" 2>/dev/null)
      if printf '%s' "$B" | grep -q '<BODY>Success</BODY>'; then
        ok "la comprobación de los iPhone (${APPLE}) llega aquí y recibe «Success»"
      else
        ojo "la comprobación de los iPhone (${APPLE}) llega aquí, pero no recibe «Success»" "el iPhone abriría su ventana de «iniciar sesión», y con Cancelar se sale de la Wi-Fi" "la web tiene que estar en marcha y en el 80"
      fi
    else
      PRIMERA=$(printf '%s\n' "$RESP" | head -n 1)
      if privada "$PRIMERA"; then
        ojo "${APPLE} lleva a ${PRIMERA}, otro aparato de la red" "el iPhone recibiría otra cosa y abriría su ventana de «iniciar sesión». Tiene que apuntar a ${IP} o a nada"
      else
        ojo "${APPLE} sale a internet (${PRIMERA}), así que este router tiene internet" "en la sala, sin cable de internet y con ese nombre apuntado a ${IP}"
      fi
    fi ;;
  # Lo mismo, el router no da nombres y no se puede arreglar.
  no) mira "los iPhone avisarán de que la red no tiene internet, y la web va igual" "el router no manda ${APPLE} a este Mac. Con un router que dé nombres, se apuntaría a ${IP}" ;;
  mudo) ojo "el DNS del router no contesta por ${APPLE}" "un iPhone esperaría su respuesta al unirse. Mira el DNS del router y que reparta el suyo" ;;
esac

pregunta "$ANDROID"
if [ "$ESTADO" = si ]; then
  for a in $RESP; do
    if es_mia "$a"; then
      mira "la comprobación de Android (${ANDROID}) también llega aquí" "está por decidir si se quiere, y lo recomendado es que no (README, punto 5)"
      break
    fi
  done
fi

# ---------- La Wi-Fi ----------
# Se le esperan 20 s como mucho. Si se queda colgado, se sigue sin la Wi-Fi.
if [ -n "$PERFIL" ]; then
  i=0
  while kill -0 "$PERFIL" 2>/dev/null && [ "$i" -lt 40 ]; do sleep 0.5; i=$((i + 1)); done
  kill "$PERFIL" 2>/dev/null || true
  wait "$PERFIL" 2>/dev/null
fi
WI=""
if [ -s "$TMP/wifi.plist" ]; then
  n=0
  while [ "$n" -lt 4 ]; do
    if [ "$(plutil -extract "0._items.0.spairport_airport_interfaces.$n._name" raw -o - "$TMP/wifi.plist" 2>/dev/null)" = "$WIFI" ]; then WI=$n; break; fi
    n=$((n + 1))
  done
fi
if [ -n "$WI" ]; then
  RED_ACTUAL="0._items.0.spairport_airport_interfaces.${WI}.spairport_current_network_information"
  CANAL=$(plutil -extract "${RED_ACTUAL}.spairport_network_channel" raw -o - "$TMP/wifi.plist" 2>/dev/null || true)
  SEGURIDAD=$(plutil -extract "${RED_ACTUAL}.spairport_security_mode" raw -o - "$TMP/wifi.plist" 2>/dev/null | sed 's/^spairport_security_mode_//; s/_/ /g' || true)
  case "$SEGURIDAD" in none) CLAVE="sin clave" ;; '') CLAVE="?" ;; *) CLAVE=$SEGURIDAD ;; esac
  N=${CANAL%% *}
  ANCHO=$(printf '%s' "$CANAL" | sed -n 's/.*[, ]\([0-9][0-9]*\) *MHz.*/\1/p')
  case "$N" in ''|*[!0-9]*) N="" ;; esac
  if [ -n "$N" ]; then
    case "$CANAL" in
      *2GHz*|*2.4GHz*)
        ojo "la Wi-Fi va en 2,4 GHz (canal ${N})" "para el público, mejor 5 GHz (README, punto 2)" ;;
      *5GHz*)
        if [ "$N" -ge 36 ] && [ "$N" -le 48 ]; then
          if [ "${ANCHO:-0}" -ge 80 ]; then ok "la Wi-Fi va en 5 GHz, canal ${N} a ${ANCHO} MHz, sin DFS (${CLAVE})"
          else ok "la Wi-Fi va en 5 GHz, canal ${N}, sin DFS (${CLAVE})" "va a ${ANCHO:-?} MHz. Si el router deja, mejor a 80"; fi
        elif [ "$N" -ge 52 ] && [ "$N" -le 144 ]; then
          ojo "la Wi-Fi va en el canal ${N}, que en España lleva DFS" "tras un corte de luz tarda en volver, y un radar la puede mover de canal. Mejor el 36 (README, punto 8)"
        else
          ojo "la Wi-Fi va en el canal ${N}, que en España va con muy poca potencia" "mejor el 36 (README, punto 8)"
        fi ;;
      *) mira "la Wi-Fi va en el canal ${CANAL}" ;;
    esac
    case "$SEGURIDAD" in
      none|open*)
        ojo "la Wi-Fi de la sala va sin clave" "está por decidir, y lo recomendado es WPA2 (README, «La clave de la Wi-Fi»)" ;;
    esac
  fi
fi

# ---------- La reserva ----------
MAC=$(ifconfig "$IF" 2>/dev/null | awk '$1 == "ether" { print $2; exit }')
if [ -n "$MAC" ]; then
  if [ -n "$WIFI" ] && [ "$IF" = "$WIFI" ]; then
    FABRICA=$(networksetup -getmacaddress "$IF" 2>/dev/null | awk '{ print $3 }')
    if [ "$MAC" != "$FABRICA" ]; then
      mira "en la reserva del router va ${MAC}, la dirección Wi-Fi privada de este Mac en esta red" "y tiene que estar en Fija, en Ajustes del Sistema > Wi-Fi > Detalles > Dirección Wi-Fi privada"
    else
      mira "en la reserva del router va ${MAC} (la Wi-Fi de este Mac)"
    fi
  else
    TIPO=$(networksetup -listallhardwareports 2>/dev/null | awk -v d="$IF" '/^Hardware Port:/ { p = substr($0, 16) } $1 == "Device:" && $2 == d { print p; exit }')
    mira "en la reserva del router va ${MAC} (${TIPO:-$IF}, ${IF})"
  fi
fi

CONCESION=$(ipconfig getoption "$IF" lease_time 2>/dev/null || true)
case "$CONCESION" in
  ''|*[!0-9]*) ;;
  *)
    if [ "$CONCESION" -gt 3600 ] && [ "$CONCESION" -lt 4294967295 ]; then
      if [ $((CONCESION % 3600)) -eq 0 ]; then CUANTO="$((CONCESION / 3600)) h"; else CUANTO="$((CONCESION / 60)) min"; fi
      mira "el router presta la IP a este Mac por ${CUANTO}" "si al público le da lo mismo, mejor 1 h (README, punto 7)"
    fi ;;
esac

N_IPS=$(printf '%s\n' "$PARES" | awk 'END { print NR }')
if [ "$N_IPS" -gt 1 ]; then
  LISTA=$(printf '%s\n' "$PARES" | awk '{ printf "%s%s en %s", s, $2, $1; s = ", " }')
  mira "este Mac tiene ${N_IPS} IP (${LISTA})" "la buena es la reservada. Si va por cable, con la Wi-Fi del Mac apagada no hay dudas"
fi

# ---------- Los carteles ----------
echo ""
if [ -n "$NOMBRE_MIO" ]; then
  echo "  los carteles se sacan así, en la carpeta web (la IP va debajo, por si algún móvil no abre el nombre)"
  if [ "$PUERTO" = 80 ]; then echo "    npm run carteles -- --red <red> --clave <clave> --ip ${IP}"
  else echo "    npm run carteles -- --red <red> --clave <clave> --web http://${NOMBRE}${SUF}/ --ip ${IP}${SUF}"; fi
else
  echo "  sin el nombre, los carteles van con la IP y se sacan así, en la carpeta web"
  echo "    npm run carteles -- --red <red> --clave <clave> --web http://${IP}${SUF}/"
fi

echo ""
cosas() { if [ "$1" -eq 1 ]; then echo "1 cosa"; else echo "$1 cosas"; fi; }
if [ "$OJOS" -eq 0 ]; then echo "  nada que arreglar, y $(cosas "$MIRAS") que mirar a mano"
else echo "  $(cosas "$OJOS") que arreglar y ${MIRAS} que mirar a mano"; fi
echo "  esto es lo que ve este Mac. Lo que ve un móvil se mira con un móvil (sala/router/README.md)"
echo ""
[ "$OJOS" -eq 0 ]
