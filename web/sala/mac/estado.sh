#!/bin/sh
# Systema 1LL0~ After Cage · cómo va el servidor de la sala
#
#   sh sala/mac/estado.sh
set -u
ETIQUETA=${1:-es.systema.servidor}
YO=$(id -u)
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
if [ "$ETIQUETA" = es.systema.servidor ]; then LOG="$HOME/Library/Logs/Systema/servidor.log"; else LOG="$HOME/Library/Logs/Systema/$ETIQUETA.log"; fi

if [ ! -f "$PLIST" ]; then
  echo "no está instalado (sh sala/mac/instalar.sh)"
  exit 1
fi
PUERTO=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:PORT' "$PLIST" 2>/dev/null || echo 80)

INFO=$(launchctl print "gui/$YO/$ETIQUETA" 2>/dev/null || true)
if [ -z "$INFO" ]; then
  echo "instalado pero no cargado. Se carga al iniciar sesión, o ahora con sh sala/mac/instalar.sh"
else
  printf '%s\n' "$INFO" | awk '/^\t(state|pid|runs|last exit code) =/ { sub(/^\t/, "  "); print }'
fi
echo ""
# Primero la respuesta, y luego se enseña. Con una tubería, el estado era el
# del sed y «no responde» no salía nunca.
SALUD=$(curl -s -m 2 "http://127.0.0.1:$PUERTO/health" 2>/dev/null || true)
if [ -n "$SALUD" ]; then
  printf '%s\n' "$SALUD" | sed 's/^/  /'
else
  echo "  no responde en el puerto $PUERTO"
fi
echo ""
echo "lo último del registro ($LOG)"
tail -n 15 "$LOG" 2>/dev/null | sed 's/^/  /'
