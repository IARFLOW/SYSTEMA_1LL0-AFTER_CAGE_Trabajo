# Systema 1LL0~ After Cage · lo que dice el cortafuegos de macOS
#
# No se lanza solo. Lo cargan instalar.sh y comprobar.sh.
#
# El cortafuegos de macOS viene apagado de fábrica. Si está activado, node
# tiene que estar en su lista con «permitir conexiones entrantes». Si no está,
# la primera vez que entra un móvil macOS pregunta en pantalla y, mientras
# nadie conteste, no deja pasar a nadie (Apple, soporte mh34041). Para saberlo
# no vale preguntar con --getappblocked, que dice «permitted» de cualquier
# programa que no esté en la lista, hasta de uno que no existe (medido en
# macOS 26.7). Así que se mira la lista entera.
FW=${SYSTEMA_FW:-/usr/libexec/ApplicationFirewall/socketfilterfw}

fw_activado() {
  [ -x "$FW" ] || return 1
  case "$("$FW" --getglobalstate 2>/dev/null)" in
    *"State = 1"*|*"State = 2"*|*"is enabled"*) return 0 ;;
    *) return 1 ;;
  esac
}

# «si» si está en la lista y puede recibir conexiones, «no» si está
# bloqueado, y nada si no está.
fw_en_lista() {
  "$FW" --listapps 2>/dev/null | awk -v ruta="$1" '
    hay { print (/Allow incoming/ ? "si" : "no"); exit }
    { l = $0; sub(/^ *[0-9]+ *: */, "", l); sub(/ +$/, "", l); if (l == ruta) hay = 1 }'
}

# Si va firmado por quien lo hace (el node de nodejs.org lo está) y está puesto
# «permitir automáticamente el software firmado descargado», que viene así de
# fábrica, el cortafuegos lo deja entrar sin preguntar aunque no esté en la lista
# (Apple, soporte mh11783). Uno de Homebrew va sin firma y no entra así.
fw_firmado_y_permitido() {
  codesign --verify "$1" 2>/dev/null || return 1
  codesign -dv "$1" 2>&1 | grep -q '^TeamIdentifier=[A-Z0-9]' || return 1
  "$FW" --getallowsigned 2>/dev/null | grep -q 'downloaded signed software ENABLED'
}

# Puede recibir conexiones? Por estar en la lista o por ir firmado.
fw_deja_entrar() {
  case "$(fw_en_lista "$1")" in
    si) return 0 ;;
    no) return 1 ;;
  esac
  fw_firmado_y_permitido "$1"
}

# Con «Bloquear todas las conexiones entrantes» no entra nadie, esté node en la
# lista o no.
fw_bloquea_todo() {
  case "$("$FW" --getglobalstate 2>/dev/null)" in *"State = 2"*) return 0 ;; esac
  "$FW" --getblockall 2>/dev/null | grep -q 'set to enabled'
}

# El modo encubierto no rompe nada, pero un iPhone con Safari 18.2 o más nuevo
# prueba primero https, y si el Mac calla en vez de rechazar, espera unos 3 s
# antes de caer a http la primera vez (lo dice el código de WebKit).
fw_encubierto() {
  "$FW" --getstealthmode 2>/dev/null | grep -q 'mode is on'
}
