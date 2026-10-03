#!/bin/sh
# Systema 1LL0~ After Cage · quitar el arranque solo del servidor
#
#   sh sala/mac/desinstalar.sh
# El registro se queda en ~/Library/Logs/Systema/, por si hace falta mirarlo.
set -u
# Con tu usuario, nunca con sudo delante. El servicio es de tu sesión, y como
# root se buscaría en la de root.
if [ "$(id -u)" = 0 ]; then
  echo "lánzalo sin sudo delante, con sh sala/mac/desinstalar.sh"
  exit 1
fi
ETIQUETA=${1:-es.systema.servidor}
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
rm -f "$PLIST"
echo "listo, el servidor ya no arranca solo (el registro sigue en ~/Library/Logs/Systema/)"
