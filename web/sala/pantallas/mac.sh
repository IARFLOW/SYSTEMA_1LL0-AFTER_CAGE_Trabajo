#!/bin/sh
# Systema 1LL0~ After Cage · las pantallas que van por cable a este Mac
#
#   sh sala/pantallas/mac.sh tele1 tele2
#       abre tele1 y tele2 en las pantallas de este Mac, de izquierda a derecha,
#       a pantalla completa y sonando sin que nadie las toque. Se queda
#       vigilándolas en esta terminal, y con Ctrl+C se cierran
#   sh sala/pantallas/mac.sh --instalar tele1 tele2
#       lo mismo, pero se queda puesto y se abren solas cada vez que se inicia sesión
#   sh sala/pantallas/mac.sh --servidor 192.168.1.20 monitor1 monitor2
#       cuando el servidor va en otro ordenador. Sin decirlo, lo busco en este
#   sh sala/pantallas/mac.sh --ver tele1 tele2
#       qué pantallas veo, en qué orden y qué abriría en cada una, sin abrir nada
#   sh sala/pantallas/mac.sh --quitar
#       lo quita y cierra las ventanas
#
#   --con-integrada   usa también la pantalla del propio portátil, que si no se
#                     queda libre (en el M4, para el Max)
#
# Cada pantalla va en su propio Chrome, con su perfil aparte, en modo quiosco
# (sin barras ni avisos) y con --autoplay-policy=no-user-gesture-required, que
# es lo que la deja sonar sin un toque. El orden es el de Ajustes del Sistema >
# Pantallas > Organizar, de izquierda a derecha (y a la misma altura, de arriba
# abajo). Si una ventana se cierra, se va a otra pantalla o su página deja de
# estar conectada al servidor, la vuelvo a abrir. Si una pantalla se apaga o se
# desenchufa, cierro su ventana para que no se vaya a otra, y la abro otra vez
# en cuanto vuelve. Mientras está en marcha, el Mac no se duerme ni apaga sus
# pantallas (caffeinate).
#
# Instalado, lo que cuenta va a ~/Library/Logs/Systema/pantallas.log.
set -u

TAB=$(printf '\t')
# Las pruebas cambian el servicio, la carpeta, el Chrome, las pantallas y los
# tiempos con estas variables.
ETIQUETA=${SYSTEMA_ETIQUETA:-es.systema.pantallas}
BASE=${SYSTEMA_PANTALLAS:-"$HOME/.systema/pantallas"}
PERFILES="$BASE/perfiles"     # un perfil de Chrome por pantalla
ESTADO="$BASE/estado"         # qué ventana va en cada pantalla, y desde cuándo
ESPERA=${SYSTEMA_ESPERA:-5}   # segundos entre vuelta y vuelta
REABRIR=${SYSTEMA_REABRIR:-10}  # como mucho una vez cada tantos segundos por ventana
GRACIA=${SYSTEMA_GRACIA:-15}    # lo que le dejo a una ventana recién abierta para colocarse
PAGINA=${SYSTEMA_PAGINA:-30}    # lo que puede estar una página sin conectar antes de abrirla otra vez
LOGS="$HOME/Library/Logs/Systema"
if [ "$ETIQUETA" = es.systema.pantallas ]; then LOG="$LOGS/pantallas.log"; else LOG="$LOGS/$ETIQUETA.log"; fi
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
YO=$(id -u)
CHROME_DADO=${CHROME:-}   # el que venga de fuera, que buscar_chrome rellena CHROME

fallo() { printf '%s\n' "$*" >&2; exit 1; }
cuenta() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
cuantas() { if [ "$1" = 1 ]; then echo "1 pantalla"; else echo "$1 pantallas"; fi; }

MODO=probar
SERVIDOR=""
INTEGRADA=0
NOMBRES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --instalar) MODO=instalar ;;
    --quitar) MODO=quitar ;;
    --ver) MODO=ver ;;
    --vigilar) MODO=vigilar ;;   # es lo que lanza el servicio, a mano no hace falta
    --con-integrada) INTEGRADA=1 ;;
    --servidor)
      [ $# -ge 2 ] || fallo "falta la dirección, por ejemplo --servidor 192.168.1.20"
      SERVIDOR=$2; shift ;;
    -h|--help|--ayuda) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) fallo "no conozco la opción $1" ;;
    *) NOMBRES="$NOMBRES $1" ;;
  esac
  shift
done

# ---------- Los nombres ----------
# En minúsculas, como los entiende el servidor, y cada uno como en el Max
# (/tele1/video), con letras sin tilde, números, _ y -. Valen separados por
# espacios o por comas.
NOMBRES=$(printf '%s' "$NOMBRES" | tr 'A-Z' 'a-z' | tr -s ' ,;' '\n' | sed '/^$/d')
for n in $NOMBRES; do
  printf '%s\n' "$n" | grep -Eq '^[a-z0-9_-]{1,32}$' ||
    fallo "«${n}» no vale como nombre de pantalla. Solo letras sin tilde, números, _ y -, y el mismo que usa el Max (/tele1/video)"
done
REPE=$(printf '%s\n' "$NOMBRES" | sort | uniq -d | head -1)
[ -z "$REPE" ] || fallo "«${REPE}» sale dos veces, y cada pantalla tiene que tener su nombre"
NOMBRES=$(printf '%s' "$NOMBRES" | paste -sd' ' -)

# ---------- Lo que ve el Mac ----------
# Una línea por pantalla (P) y otra por cada ventana de los Chrome que le pida
# por su número de proceso (V), con la más grande de cada uno.
#   P  integrada (1 si es la del portátil), x, y, ancho, alto, id, nombre
#   V  pid, x, y, ancho, alto
# Todo en los puntos de macOS, que son los que usa Chrome para colocar ventanas.
# El id es el fabricante, el modelo y el número de serie de la pantalla. Por las
# coordenadas no se la reconoce, porque al quitar una pantalla macOS recoloca
# las demás (la principal siempre empieza en 0,0). Solo cuentan las ventanas que
# se ven. Una cerrada con Cmd+W, escondida con Cmd+H o en otro escritorio de su
# pantalla no sale, y así se nota que hay que abrirla otra vez. Leer dónde está
# una ventana no pide el permiso de grabar la pantalla, que eso es para su título.
JXA='ObjC.import("AppKit"); ObjC.import("CoreGraphics");
function run(argv) {
  var out = [], s = $.NSScreen.screens;
  for (var i = 0; i < s.count; i++) {
    var p = s.objectAtIndex(i);
    var n = ObjC.unwrap(p.deviceDescription.objectForKey("NSScreenNumber"));
    var b = $.CGDisplayBounds(n), nombre = "";
    try { nombre = ObjC.unwrap(p.localizedName) || ""; } catch (e) {}
    out.push(["P", $.CGDisplayIsBuiltin(n) ? 1 : 0, Math.round(b.origin.x), Math.round(b.origin.y),
      Math.round(b.size.width), Math.round(b.size.height),
      [$.CGDisplayVendorNumber(n), $.CGDisplayModelNumber(n), $.CGDisplaySerialNumber(n)].join("-"),
      nombre.replace(/\s+/g, " ")].join("\t"));
  }
  if (argv.length) {
    var quiero = {}, mejor = {};
    argv.forEach(function (a) { quiero[a] = true; });
    var l = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0));
    for (var j = 0; j < l.count; j++) {
      var v = l.objectAtIndex(j);
      var pid = String(ObjC.unwrap(v.objectForKey("kCGWindowOwnerPID")));
      if (!quiero[pid] || ObjC.unwrap(v.objectForKey("kCGWindowLayer")) !== 0) continue;
      if (ObjC.unwrap(v.objectForKey("kCGWindowIsOnscreen")) !== true) continue;
      var r = ObjC.deepUnwrap(v.objectForKey("kCGWindowBounds"));
      if (r && (!mejor[pid] || r.Width * r.Height > mejor[pid].Width * mejor[pid].Height)) mejor[pid] = r;
    }
    for (var k in mejor) out.push(["V", k, Math.round(mejor[k].X), Math.round(mejor[k].Y),
      Math.round(mejor[k].Width), Math.round(mejor[k].Height)].join("\t"));
  }
  return out.join("\n");
}'
leer() {   # los números de proceso de las ventanas que quiero localizar
  if [ -n "${SYSTEMA_PANTALLAS_FALSAS:-}" ]; then
    sed "/^[[:space:]]*\$/d; s/^/P$TAB/" "$SYSTEMA_PANTALLAS_FALSAS" 2>/dev/null
    [ -z "${SYSTEMA_VENTANAS_FALSAS:-}" ] || sed "/^[[:space:]]*\$/d; s/^/V$TAB/" "$SYSTEMA_VENTANAS_FALSAS" 2>/dev/null
  else
    osascript -l JavaScript -e "$JXA" "$@" 2>/dev/null
  fi
  return 0
}
# Las pantallas de una lectura, sin la P y ordenadas de izquierda a derecha (y a
# la misma x, de arriba abajo).
pantallas() {
  printf '%s\n' "$1" | awk -F "$TAB" -v OFS="$TAB" '$1 == "P" { for (i = 2; i <= NF; i++) printf "%s%s", $i, (i < NF ? OFS : "\n") }' |
    sort -t "$TAB" -k2,2n -k3,3n
}
# Los números de proceso de las ventanas abiertas, para pedir dónde están.
pids() { for n in $NOMBRES; do cat "$ESTADO/$n.pid" 2>/dev/null; done | tr '\n' ' '; }

# ---------- Qué va en cada una ----------
# La primera vez, o cuando alguien lo lanza a mano, el primer nombre va en la
# pantalla de más a la izquierda, el segundo en la siguiente, y así. La del
# portátil no cuenta, salvo con --con-integrada. En cuanto están todas, apunto
# en «colocacion» qué pantalla le tocó a cada nombre, por su id.
# Desde entonces cada nombre va a su pantalla, esté donde esté, y si la suya no
# está, espera. Así, si falta una, las demás no se corren un puesto, que si no
# tele1 saldría en la tele de tele2. Pero si se ven tantas pantallas como
# nombres y alguno no encuentra la suya (han cambiado la tele por otra, o el
# cable va a otro conector), se queda con la que sobra y desde ahí es la suya.
# Dos pantallas iguales (mismo modelo y sin número de serie, como tantas teles)
# se distinguen por su orden, y si falta una de las dos no hay manera de saber
# cuál, así que la que queda se la lleva la que iba primero. Si no hay nada
# apuntado y faltan pantallas, las pongo en orden y lo digo.
# Sale una línea por nombre (nombre, clave de su pantalla, x, y, ancho y alto, o
# un - si espera), una con ! por cada uno que cambia de pantalla así, y una
# última con cómo se ha hecho y cuántas pantallas había.
planificar() {   # las pantallas en orden, y el fichero de lo apuntado
  printf '%s\n' "$1" | awk -F "$TAB" -v OFS="$TAB" -v nombres="$NOMBRES" -v integrada="$INTEGRADA" \
    -v memoria="$2" '
    BEGIN {
      n = split(nombres, N, " ")
      for (i = 1; i <= n; i++) Q[N[i]] = 1
      while ((getline linea < memoria) > 0) {
        split(linea, c, "\t")
        if (c[1] in Q) { M[c[1]] = c[2]; hay++ }
      }
    }
    NF >= 6 && ($1 == 0 || integrada == 1) {
      k++; X[k] = $2; Y[k] = $3; W[k] = $4; H[k] = $5; K[k] = $6 "#" (++igual[$6])
    }
    END {
      if (!hay) {
        modo = (k >= n) ? "todas" : "en_orden"
        for (i = 1; i <= n && i <= k; i++) A[i] = i
      } else {
        for (i = 1; i <= n; i++) if (N[i] in M) for (d = 1; d <= k; d++)
          if (!(d in U) && K[d] == M[N[i]]) { A[i] = d; U[d] = 1; break }
        # Un nombre que no estaba la última vez va a la primera que sobre.
        d = 1
        for (i = 1; i <= n; i++) if (!(N[i] in M)) {
          while (d <= k && (d in U)) d++
          if (d <= k) { A[i] = d; U[d] = 1 }
        }
        # Y con tantas pantallas como nombres, el que no encuentra la suya se
        # queda con la que sobre.
        if (k >= n) {
          d = 1
          for (i = 1; i <= n; i++) if (!(i in A)) {
            while (d <= k && (d in U)) d++
            if (d <= k) { A[i] = d; U[d] = 1; nueva[i] = 1 }
          }
        }
        modo = "todas"
        for (i = 1; i <= n; i++) if (!(i in A)) modo = "memoria"
      }
      for (i = 1; i <= n; i++)
        print N[i], ((i in A) ? (K[A[i]] OFS X[A[i]] OFS Y[A[i]] OFS W[A[i]] OFS H[A[i]]) : "-")
      for (i = 1; i <= n; i++) if (i in nueva) print "!", N[i]
      print "#", modo, k + 0
    }'
}

# ---------- Cada ventana ----------
viva() {
  pid=$(cat "$ESTADO/$1.pid" 2>/dev/null || true)
  [ -n "$pid" ] || return 1
  # Que siga ahí, que no sea un proceso muerto sin recoger y que sea el Chrome
  # de esa pantalla, no otro programa que haya heredado el número.
  ps -ww -p "$pid" -o stat= -o command= 2>/dev/null | grep -v '^ *Z' | grep -Eq "$PERFILES/$1( |\$)"
}

cerrar() {
  # El número apuntado solo si sigue siendo su Chrome. Tras un apagón o un
  # reinicio puede ser ya de otro programa (el Max, el servidor), y a ese ni
  # tocarlo.
  i=4
  if viva "$1"; then kill -TERM "$(cat "$ESTADO/$1.pid")" 2>/dev/null || true; i=0; fi
  # Y lo que quede de ese perfil, de una vez anterior o de un Chrome colgado.
  # Con otro Chrome abierto con ese perfil, el nuevo le pasaría la dirección y
  # se cerraría al momento.
  patron="$PERFILES/$1( |\$)"
  while pgrep -f "$patron" >/dev/null 2>&1; do
    [ $i -ne 4 ] || pkill -TERM -f "$patron" 2>/dev/null || true
    if [ $i -ge 20 ]; then pkill -KILL -f "$patron" 2>/dev/null || true; break; fi
    i=$((i + 1)); sleep 0.25
  done
  rm -f "${ESTADO:?}/$1.pid" "${ESTADO:?}/$1.donde"
}

# --kiosk               pantalla completa, sin barras y sin los avisos del arranque
# --autoplay-policy=no-user-gesture-required   suena sin que nadie la toque
# --no-first-run, --no-default-browser-check   sin la bienvenida ni la pregunta
#                       de si quiero que sea el navegador por defecto
# --noerrdialogs, --hide-crash-restore-bubble  sin ventanas de error, ni la de
#                       restaurar páginas si se cerró de golpe
# --use-mock-keychain   sin el llavero, que tras un reinicio puede quedarse
#                       pidiendo la contraseña con nadie delante
# --disable-background-timer-throttling y los dos de detrás, que no frene la
#                       página aunque macOS crea que la ventana no se ve
# --window-position y --window-size, la ventana encima de su pantalla, y el
#                       modo quiosco la pone a pantalla completa en esa
abrir() {   # nombre clave x y ancho alto
  cerrar "$1"
  mkdir -p "$PERFILES/$1"
  (
    "$CHROME" --user-data-dir="$PERFILES/$1" \
      --kiosk --autoplay-policy=no-user-gesture-required \
      --no-first-run --no-default-browser-check \
      --noerrdialogs --hide-crash-restore-bubble --use-mock-keychain \
      --disable-features=Translate \
      --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
      --disable-renderer-backgrounding \
      --window-position="$3,$4" --window-size="$5,$6" \
      "$SERVIDOR/screen/$1" </dev/null >/dev/null 2>&1 &
    echo $! > "$ESTADO/$1.pid"
  )
  printf '%s\n' "$2" > "$ESTADO/$1.donde"
  date +%s > "$ESTADO/$1.desde"
  rm -f "${ESTADO:?}/$1.sin" "${ESTADO:?}/$1.casi" "${ESTADO:?}/$1.desconectada"
}

# Lo que se ha quedado sin su pantalla, o va a ir a otra, se cierra en cuanto se
# ve, haya servidor o no. Si no, macOS se llevaría la ventana a otra pantalla y
# taparía el Max o la otra tele hasta la vuelta siguiente.
retirar() {   # el plan
  printf '%s\n' "$1" | while IFS="$TAB" read -r nombre clave x y w h; do
    case "$nombre" in '#'|'!') continue ;; esac
    [ -f "$ESTADO/$nombre.donde" ] || continue
    [ "$(cat "$ESTADO/$nombre.donde")" != "$clave" ] || continue
    cerrar "$nombre"
    if [ "$clave" = - ]; then
      : > "$ESTADO/$nombre.sin"
      cuenta "cierro $nombre, que su pantalla ya no está, y la abro en cuanto vuelva"
    else
      cuenta "cierro $nombre, que le toca otra pantalla"
    fi
  done
}

colocar() {   # el plan
  printf '%s\n' "$1" | while IFS="$TAB" read -r nombre clave x y w h; do
    case "$nombre" in
      '#') continue ;;
      '!') cuenta "$clave no encuentra su pantalla y sobra otra, así que la pongo ahí y desde ahora es la suya"; continue ;;
    esac
    # Con las pantallas cambiadas, la que me había rendido tiene otra oportunidad.
    rm -f "${ESTADO:?}/$nombre.rendida" "${ESTADO:?}/$nombre.intentos"
    if [ "$clave" = - ]; then
      [ -f "$ESTADO/$nombre.sin" ] || cuenta "$nombre se queda sin abrir hasta que aparezca su pantalla"
      : > "$ESTADO/$nombre.sin"
      [ ! -f "$ESTADO/$nombre.donde" ] || cerrar "$nombre"
    elif [ "$(cat "$ESTADO/$nombre.donde" 2>/dev/null)" != "$clave" ] || ! viva "$nombre"; then
      abrir "$nombre" "$clave" "$x" "$y" "$w" "$h"
      cuenta "abro $nombre en la pantalla de ${w}×${h} que empieza en $x,$y"
    fi
  done
  modo=$(printf '%s\n' "$1" | awk -F "$TAB" '$1 == "#" { print $2 }')
  vistas=$(printf '%s\n' "$1" | awk -F "$TAB" '$1 == "#" { print $3 }')
  case "$modo" in
    todas) printf '%s\n' "$1" | awk -F "$TAB" -v OFS="$TAB" '$1 != "#" && $1 != "!" && $2 != "-" { print $1, $2 }' > "$ESTADO/colocacion" ;;
    en_orden) cuenta "ojo, veo $(cuantas "$vistas") para $(printf '%s' "$NOMBRES" | wc -w | tr -d ' ') nombres, y no sé cuál falta, así que las pongo en orden. En cuanto estén todas, cada una vuelve a su sitio" ;;
  esac
}

# Que cada ventana esté de verdad en su pantalla y se vea. Si una tele se apaga
# y se enciende entre dos miradas, macOS puede haberse llevado su ventana a
# otra pantalla, encima del Max, por ejemplo. Y un Cmd+W o un Cmd+H dejan Chrome
# en marcha con la tele en negro. En los dos casos la abro otra vez en la suya.
# A una recién abierta le dejo unos segundos para colocarse, y una sin ventana
# tiene que salir así dos veces seguidas, por si era una animación. Si a la
# tercera sigue igual, la cierro para que no tape otra pantalla, lo digo, y lo
# vuelvo a intentar cuando cambien las pantallas.
comprobar_ventanas() {   # el plan aplicado y la última lectura
  reales=1
  [ -z "${SYSTEMA_PANTALLAS_FALSAS:-}" ] || reales=0
  printf '%s\n' "$1" | while IFS="$TAB" read -r nombre clave x y w h; do
    case "$nombre" in '#'|'!') continue ;; esac
    [ "$clave" != - ] && [ ! -f "$ESTADO/$nombre.rendida" ] || continue
    viva "$nombre" || continue
    desde=$(cat "$ESTADO/$nombre.desde" 2>/dev/null || echo 0)
    [ $(($(date +%s) - desde)) -ge "$GRACIA" ] || continue
    # Con pantallas de mentira, una ventana que no sale es que no se sabe, salvo
    # que la línea lo diga con un -.
    sitio=$(printf '%s\n' "$2" | awk -F "$TAB" -v p="$(cat "$ESTADO/$nombre.pid")" -v reales="$reales" \
      -v x="$x" -v y="$y" -v w="$w" -v h="$h" '
      $1 == "V" && $2 == p {
        visto = 1
        if ($3 == "-") { print "sin"; exit }
        cx = $3 + $5 / 2; cy = $4 + $6 / 2
        print (cx >= x && cx < x + w && cy >= y && cy < y + h) ? "bien" : "fuera"; exit
      }
      END { if (!visto && reales) print "sin" }')
    case "$sitio" in
      bien) rm -f "${ESTADO:?}/$nombre.intentos" "${ESTADO:?}/$nombre.casi"; continue ;;
      sin)
        if [ ! -f "$ESTADO/$nombre.casi" ]; then : > "$ESTADO/$nombre.casi"; continue; fi
        motivo="no tenía ventana (cerrada, escondida o en otro escritorio)" ;;
      fuera) motivo="no estaba en su pantalla" ;;
      *) continue ;;
    esac
    rm -f "${ESTADO:?}/$nombre.casi"
    veces=$(($(cat "$ESTADO/$nombre.intentos" 2>/dev/null || echo 0) + 1))
    echo "$veces" > "$ESTADO/$nombre.intentos"
    if [ "$veces" -gt 3 ]; then
      cerrar "$nombre"
      : > "$ESTADO/$nombre.rendida"
      cuenta "no consigo dejar $nombre bien en su pantalla, así que la cierro para que no tape otra. Lo vuelvo a intentar cuando cambien las pantallas, o al reiniciar"
      continue
    fi
    cuenta "$nombre $motivo, la abro otra vez en la suya"
    abrir "$nombre" "$clave" "$x" "$y" "$w" "$h"
  done
}

# Si una ventana se ha cerrado sola, la abro otra vez donde iba. Las que he
# cerrado yo (su pantalla se ha ido, le toca otra, me he rendido) ya no tienen
# su .donde, y esas no.
revivir() {
  printf '%s\n' "$APLICADO" | while IFS="$TAB" read -r nombre clave x y w h; do
    case "$nombre" in '#'|'!') continue ;; esac
    [ "$clave" != - ] && [ ! -f "$ESTADO/$nombre.rendida" ] || continue
    [ "$(cat "$ESTADO/$nombre.donde" 2>/dev/null)" = "$clave" ] || continue
    viva "$nombre" && continue
    desde=$(cat "$ESTADO/$nombre.desde" 2>/dev/null || echo 0)
    [ $(($(date +%s) - desde)) -ge "$REABRIR" ] || continue
    cuenta "$nombre se había cerrado, la vuelvo a abrir"
    rm -f "${ESTADO:?}/$nombre.intentos"
    abrir "$nombre" "$clave" "$x" "$y" "$w" "$h"
  done
}

# Que la página de cada una esté conectada al servidor. Si la pestaña se cae
# («Aw, Snap») o se queda colgada, Chrome sigue vivo y la tele en negro, pero el
# servidor deja de verla. Si lleva más de PAGINA segundos sin conectar, la abro
# otra vez. Un servidor de antes del 12-oct no da la lista, y entonces no miro.
paginas() {
  abiertas=$(printf '%s\n' "$SALUD" | awk '$1 == "displays" { $1 = ""; print $0 " "; f = 1 } END { if (!f) print "?" }')
  [ "$abiertas" != "?" ] || return 0
  ya=$(date +%s)
  printf '%s\n' "$APLICADO" | while IFS="$TAB" read -r nombre clave x y w h; do
    case "$nombre" in '#'|'!') continue ;; esac
    [ "$clave" != - ] && [ ! -f "$ESTADO/$nombre.rendida" ] || continue
    viva "$nombre" || continue
    case "$abiertas" in *" $nombre "*) rm -f "${ESTADO:?}/$nombre.desconectada"; continue ;; esac
    desde=$(cat "$ESTADO/$nombre.desde" 2>/dev/null || echo 0)
    [ $((ya - desde)) -ge "$GRACIA" ] || continue
    if [ ! -f "$ESTADO/$nombre.desconectada" ]; then echo "$ya" > "$ESTADO/$nombre.desconectada"; continue; fi
    [ $((ya - $(cat "$ESTADO/$nombre.desconectada"))) -ge "$PAGINA" ] || continue
    cuenta "la página de $nombre lleva más de $PAGINA s sin conectar con el servidor, la abro otra vez"
    abrir "$nombre" "$clave" "$x" "$y" "$w" "$h"
  done
}

# Lo que contesta el servidor a /health?pantallas. La primera línea es ok, y la
# de displays dice qué pantallas tienen su página abierta.
SALUD=''
responde() {
  SALUD=$(curl -s -m 3 "$1/health?pantallas" 2>/dev/null) || SALUD=''
  printf '%s\n' "$SALUD" | head -1 | grep -q '^ok'
}

terminar() {
  trap - INT TERM HUP
  for n in $NOMBRES; do cerrar "$n"; done
  [ "$(cat "$ESTADO/vigilante.pid" 2>/dev/null)" != $$ ] || rm -f "${ESTADO:?}/vigilante.pid"
  cuenta "cierro las pantallas"
  exit 0
}

# El número del que vigila, si sigue en marcha y es este script (un sh con
# mac.sh). Si no, el número es de una vez anterior o ya es de otro programa,
# como el caffeinate del propio servicio, que lleva mac.sh en su orden.
otro_vigilante() {
  otro=$(cat "$ESTADO/vigilante.pid" 2>/dev/null || true)
  [ -n "$otro" ] && [ "$otro" != $$ ] || return 1
  ps -ww -p "$otro" -o command= 2>/dev/null | grep -Eq '^ *[^ ]*sh .*mac\.sh' || return 1
  printf '%s\n' "$otro"
}

# Uno solo vigilando a la vez. Dos se pelearían por las mismas ventanas.
cerrojo() {
  if otro=$(otro_vigilante); then
    fallo "ya hay otro vigilando las pantallas de este Mac (el proceso $otro). Si es el instalado, quítalo antes con sh sala/pantallas/mac.sh --quitar, y si va en otra terminal, ciérralo allí con Ctrl+C"
  fi
  echo $$ > "$ESTADO/vigilante.pid"
}

vigilar() {
  mkdir -p "$PERFILES" "$ESTADO"
  cerrojo
  trap terminar INT TERM HUP
  for f in sin rendida intentos casi desconectada; do rm -f "${ESTADO:?}"/*."$f"; done
  cuenta "pongo $NOMBRES con el servidor de $SERVIDOR"
  APLICADO=''; VISTAS=''; CAIDO=''; vuelta=0
  while :; do
    ok=0
    if responde "$SERVIDOR"; then
      [ "$CAIDO" != 1 ] || cuenta "el servidor ya contesta"
      CAIDO=0; ok=1
    else
      # Sin servidor no abro nada. Chrome se quedaría en su página de error,
      # reintentando cada vez más despacio. Las que ya están abiertas se
      # reconectan solas.
      [ "$CAIDO" = 1 ] || cuenta "el servidor no contesta en $SERVIDOR, espero a que conteste"
      CAIDO=1
    fi
    # Las pantallas, una vuelta sí y otra no, que preguntarlo cuesta algo. Lo
    # que se queda sin pantalla se cierra en cuanto se ve. Lo demás no se aplica
    # hasta que se lee igual dos veces seguidas, porque una tele al encenderse
    # puede aparecer y desaparecer un par de veces.
    if [ -z "$APLICADO" ] || [ $((vuelta % 2)) -eq 0 ]; then
      # shellcheck disable=SC2046
      lectura=$(leer $(pids))
      ahora=$(pantallas "$lectura")
      plan=$(planificar "$ahora" "$ESTADO/colocacion")
      retirar "$plan"
      if [ "$ok" = 1 ] && { [ -z "$APLICADO" ] || [ "$ahora" = "$VISTAS" ]; }; then
        if [ "$plan" != "$APLICADO" ]; then colocar "$plan"; APLICADO=$plan; fi
        comprobar_ventanas "$APLICADO" "$lectura"
      fi
      VISTAS=$ahora
    fi
    if [ "$ok" = 1 ] && [ -n "$APLICADO" ]; then revivir; paginas; fi
    vuelta=$((vuelta + 1))
    sleep "$ESPERA" & wait $!
  done
}

# ---------- Lo que hace falta ----------
buscar_servidor() {
  if [ -n "$SERVIDOR" ]; then
    SERVIDOR=$(printf '%s' "$SERVIDOR" | sed 's#/*$##')
    case "$SERVIDOR" in http://*|https://*) ;; *) SERVIDOR="http://$SERVIDOR" ;; esac
    printf '%s\n' "$SERVIDOR" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' ||
      fallo "«${SERVIDOR}» no parece una dirección. Pon la IP del Mac del servidor (192.168.1.20) o http://systema.internal"
    responde "$SERVIDOR" ||
      echo "ojo, el servidor no contesta ahora en $SERVIDOR. Las abro en cuanto conteste"
  else
    for c in http://127.0.0.1 http://127.0.0.1:8080; do
      if responde "$c"; then SERVIDOR=$c; return 0; fi
    done
    fallo "no encuentro el servidor en este Mac, ni en el 80 ni en el 8080. Arráncalo, o si va en otro ordenador dime dónde con --servidor y su IP"
  fi
}

buscar_chrome() {
  if [ -z "${CHROME:-}" ]; then
    for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
             "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
      if [ -x "$c" ]; then CHROME=$c; break; fi
    done
  fi
  [ -n "${CHROME:-}" ] && [ -x "$CHROME" ] ||
    fallo "falta Google Chrome. Se baja de https://www.google.com/chrome y se instala como cualquier programa"
}

# Con «Pantallas con Spaces separados» apagado, una ventana a pantalla completa
# deja en negro las demás pantallas, y no podrían ir dos a la vez.
espacios() {
  [ "$(defaults read com.apple.spaces spans-displays 2>/dev/null)" = 1 ] || return 0
  echo "ojo, en Ajustes del Sistema > Escritorio y Dock está desactivado «Pantallas con Spaces separados»,"
  echo "y así una ventana a pantalla completa deja en negro las demás. Actívalo, cierra sesión y vuelve a entrar"
}

# Lo que veo y qué iría en cada una.
ver() {
  lista=$(pantallas "$(leer)")
  if [ -z "$lista" ]; then echo "no veo ninguna pantalla"; return 0; fi
  plan=''
  # Con lo apuntado, que es lo que aplica el que vigila. Al lanzarlo a mano se
  # borra antes, y entonces sale el reparto de izquierda a derecha.
  [ -z "$NOMBRES" ] || plan=$(planificar "$lista" "$ESTADO/colocacion")
  echo "este Mac ve $(cuantas "$(printf '%s\n' "$lista" | wc -l | tr -d ' ')"), de izquierda a derecha"
  # El plan va por el entorno, que awk no admite saltos de línea en -v.
  printf '%s\n' "$lista" | PLAN=$plan awk -F "$TAB" -v integrada="$INTEGRADA" '
    BEGIN {
      plan = ENVIRON["PLAN"]
      m = split(plan, P, "\n")
      for (i = 1; i <= m; i++) { split(P[i], c, "\t"); if (c[1] != "#" && c[1] != "!" && c[2] != "-") Q[c[3] "," c[4]] = c[1] }
    }
    {
      nombre = ($7 == "") ? "pantalla" : $7
      if ($2 "," $3 in Q) que = "→ " Q[$2 "," $3]
      else if ($1 == 1 && integrada != 1) que = "la del portátil, que la dejo libre (con --con-integrada la uso)"
      else que = (plan == "") ? "" : "sin nada"
      printf "  %d  %-28s %5s×%-5s en %s,%s  %s\n", NR, nombre, $4, $5, $2, $3, que
    }'
  [ -z "$plan" ] || printf '%s\n' "$plan" | awk -F "$TAB" '
    $1 == "#" && $2 == "en_orden" { print "  faltan pantallas y no sé cuál, así que van en orden y alguna saldrá en la tele de otra" }
    $1 == "!" { print "  " $2 " no encuentra su pantalla de la otra vez y se queda con la que sobra" }
    $1 != "#" && $1 != "!" && $2 == "-" { print "  " $1 " se queda sin pantalla hasta que aparezca la suya" }'
  [ -z "$plan" ] || [ ! -s "$ESTADO/colocacion" ] ||
    echo "  (es lo apuntado la última vez que estaban todas. Al lanzarlo a mano se reparte otra vez de izquierda a derecha)"
  espacios
}

# ---------- Cada modo ----------
case "$MODO" in
  ver)
    ver ;;

  vigilar)
    [ -n "$NOMBRES" ] || fallo "faltan los nombres de las pantallas"
    buscar_chrome
    [ -n "$SERVIDOR" ] || fallo "falta --servidor"
    vigilar ;;

  probar)
    [ -n "$NOMBRES" ] || fallo "dime qué pantallas pongo en este Mac, por ejemplo sh sala/pantallas/mac.sh tele1 tele2"
    [ ! -f "$PLIST" ] || fallo "en este Mac ya están instaladas, y se abren solas. Para probar a mano, quítalas antes con sh sala/pantallas/mac.sh --quitar"
    buscar_chrome
    buscar_servidor
    mkdir -p "$ESTADO"
    if otro=$(otro_vigilante); then
      fallo "ya hay otro vigilando las pantallas de este Mac (el proceso $otro). Ciérralo antes con Ctrl+C en su terminal"
    fi
    # A mano se reparte otra vez de izquierda a derecha y se olvida lo apuntado.
    # Así, si dos estaban cambiadas, basta con cambiar el orden de los nombres o
    # de las pantallas y volver a lanzarlo.
    rm -f "${ESTADO:?}/colocacion"
    ver
    echo ""
    echo "las abro con el servidor de $SERVIDOR y me quedo vigilándolas. Ctrl+C las cierra"
    caffeinate -dims -w $$ >/dev/null 2>&1 &
    vigilar ;;

  instalar)
    [ "$YO" != 0 ] || fallo "lánzalo sin sudo delante, que el servicio va con tu usuario"
    [ -n "$NOMBRES" ] || fallo "dime qué pantallas pongo en este Mac, por ejemplo sh sala/pantallas/mac.sh --instalar tele1 tele2"
    buscar_chrome
    buscar_servidor
    mkdir -p "$BASE" "$ESTADO" "$PERFILES" "$LOGS" "$HOME/Library/LaunchAgents"
    otro=$(otro_vigilante || true)
    if [ -n "$otro" ] && ! launchctl print "gui/$YO/$ETIQUETA" >/dev/null 2>&1; then
      fallo "ya las tienes abiertas desde una terminal. Ciérralas allí con Ctrl+C y vuelve a lanzar esto"
    fi
    # El servicio lanza una copia de este script que vive en tu carpeta. macOS
    # no deja que un servicio lea el Escritorio, Documentos ni Descargas sin un
    # permiso que se pide en pantalla, y esto suele estar ahí.
    cp "$0" "$BASE/mac.sh.nuevo" && mv "$BASE/mac.sh.nuevo" "$BASE/mac.sh"
    if [ -f "$LOG" ] && [ "$(stat -f %z "$LOG")" -gt 20000000 ]; then
      mv "$LOG" "$LOG.$(date +%Y%m%d-%H%M%S)"
    fi
    launchctl bootout "gui/$YO/$ETIQUETA" 2>/dev/null || true
    # Que el de antes acabe de cerrar sus ventanas, o el nuevo se encontraría
    # su cerrojo y tendría que esperar a que launchd lo relanzara.
    i=0
    while [ -n "$otro" ] && ps -p "$otro" >/dev/null 2>&1 && [ $i -lt 40 ]; do sleep 0.25; i=$((i + 1)); done
    # Como al probar, de izquierda a derecha otra vez.
    rm -f "${ESTADO:?}/colocacion"
    xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
    # Las variables de las pruebas, si las hay, también para el servicio.
    entorno() {
      lista=''
      for v in SYSTEMA_PANTALLAS SYSTEMA_PANTALLAS_FALSAS SYSTEMA_VENTANAS_FALSAS SYSTEMA_ESPERA SYSTEMA_REABRIR SYSTEMA_GRACIA SYSTEMA_PAGINA CHROME_DADO; do
        eval "valor=\${$v:-}"
        [ "$v" != CHROME_DADO ] || v=CHROME
        [ -z "$valor" ] || lista="$lista    <key>$v</key>\n    <string>$(xml "$valor")</string>\n"
      done
      [ -z "$lista" ] || printf '  <key>EnvironmentVariables</key>\n  <dict>\n%b  </dict>\n' "$lista"
    }
    {
      printf '    <string>%s</string>\n' /usr/bin/caffeinate -dims /bin/sh "$(xml "$BASE/mac.sh")" --vigilar --servidor "$(xml "$SERVIDOR")"
      [ "$INTEGRADA" = 0 ] || printf '    <string>--con-integrada</string>\n'
      for n in $NOMBRES; do printf '    <string>%s</string>\n' "$n"; done
    } > "$BASE/argumentos"
    # Con KeepAlive, si esto se cae, launchd lo levanta a los 10 s, y al caerse
    # se lleva sus ventanas, que vuelven a abrirse con él. Solo en la sesión con
    # pantalla (Aqua), que fuera de ella Chrome no puede abrir ventanas.
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$ETIQUETA</string>
  <key>ProgramArguments</key>
  <array>
$(cat "$BASE/argumentos")
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
$(entorno)
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
    rm -f "${BASE:?}/argumentos"
    plutil -lint "$PLIST" >/dev/null || fallo "no me ha salido bien el servicio ($PLIST)"
    launchctl enable "gui/$YO/$ETIQUETA" 2>/dev/null || true
    if ! launchctl bootstrap "gui/$YO" "$PLIST"; then
      echo "macOS no ha dejado arrancar el servicio. Mira en Ajustes del Sistema > General > Ítems de inicio"
      echo "y extensiones que «caffeinate» esté activado, y vuelve a lanzar esto, sin sudo delante."
      exit 1
    fi
    ver
    echo ""
    # Que se abran de verdad, hasta 30 s.
    i=0; faltan=$NOMBRES
    while [ -n "$faltan" ] && [ $i -lt 30 ]; do
      sleep 1; i=$((i + 1)); quedan=''
      for n in $faltan; do
        viva "$n" || [ -f "$ESTADO/$n.sin" ] || quedan="$quedan $n"
      done
      faltan=$(printf '%s' "$quedan" | sed 's/^ //')
    done
    for n in $NOMBRES; do
      if viva "$n"; then echo "  $n abierta"
      elif [ -f "$ESTADO/$n.sin" ]; then echo "  $n sin pantalla, se abre en cuanto aparezca la suya"
      else echo "  $n todavía no se ha abierto. Mira el registro, $LOG"
      fi
    done
    echo ""
    echo "  listo, se abren solas cada vez que se inicia sesión en este usuario, con el servidor de $SERVIDOR"
    echo "  registro   $LOG"
    echo "  quitarlo   sh sala/pantallas/mac.sh --quitar"
    espacios ;;

  quitar)
    launchctl bootout "gui/$YO/$ETIQUETA" 2>/dev/null || true
    rm -f "${PLIST:?}"
    # Si iba en una terminal, que se cierre él, con sus ventanas.
    otro=$(otro_vigilante || true)
    if [ -n "$otro" ]; then
      kill -TERM "$otro" 2>/dev/null || true
      sleep 2
    fi
    # Y las ventanas que queden sueltas.
    if [ -d "$PERFILES" ]; then
      for d in "$PERFILES"/*; do [ -d "$d" ] && cerrar "$(basename "$d")"; done
    fi
    rm -f "${ESTADO:?}/vigilante.pid" "${ESTADO:?}"/*.sin "${ESTADO:?}"/*.desde "${ESTADO:?}"/*.rendida
    echo "quitado. Las pantallas ya no se abren solas en este Mac" ;;
esac
