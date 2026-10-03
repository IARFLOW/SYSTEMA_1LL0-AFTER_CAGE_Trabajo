#!/bin/sh
# Systema 1LL0~ After Cage
# doble clic y arranca la web en este mac, con el max escuchando en el 9100
# pa pararla, cierra la ventana de la terminal

cd "$(dirname "$0")/web" || exit 1
PUERTO="${PORT:-8080}"

parar() {
  echo ""
  echo "  (Intro pa cerrar)"
  read -r _
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  falta node en este mac"
  echo "  se baja de https://nodejs.org (el botón de la versión LTS) y se instala como cualquier programa"
  echo "  luego vuelve a darle doble clic a arrancar.command"
  parar
fi

# node-osc pide la 22.11 o una más nueva
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 11) ? 0 : 1)'; then
  echo ""
  echo "  este node es el $(node -v) y hace falta el 22.11 o uno más nuevo"
  echo "  bájate el de la versión LTS de https://nodejs.org, instálalo encima y vuelve a darle doble clic"
  parar
fi

# la primera vez se baja lo que necesita la web (hace falta internet)
if [ ! -d node_modules ]; then
  echo ""
  echo "  primera vez, me bajo lo que necesita la web, tarda un poquito"
  echo ""
  if ! npm install --no-audit --no-fund; then
    rm -rf node_modules
    echo ""
    echo "  no se ha podido bajar, mira si hay internet y vuelve a darle doble clic"
    parar
  fi
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "  Systema 1LL0~ After Cage"
echo ""
echo "  el panel de la sala     http://localhost:$PUERTO/panel"
echo "  las teles               http://localhost:$PUERTO/screen/tele1"
echo "                          http://localhost:$PUERTO/screen/tele2"
if [ -n "$IP" ]; then
  echo "  en el móvil             http://$IP:$PUERTO   (en la misma wifi que el mac)"
fi
echo ""
echo "  pa pararla, cierra esta ventana"
echo ""

PORT="$PUERTO" node server/index.js --dev &
SERVIDOR=$!

# cuando ya escucha, abre el panel y las dos teles en el navegador
sleep 1
i=0
while kill -0 "$SERVIDOR" 2>/dev/null && [ "$i" -lt 40 ]; do
  if curl -s -m 1 "http://127.0.0.1:$PUERTO/health" | head -1 | grep -q '^ok'; then
    open "http://localhost:$PUERTO/panel"
    open "http://localhost:$PUERTO/screen/tele1"
    open "http://localhost:$PUERTO/screen/tele2"
    break
  fi
  sleep 0.25
  i=$((i + 1))
done

wait "$SERVIDOR"
echo ""
echo "  el servidor se ha parado, mira el mensaje de arriba"
parar
