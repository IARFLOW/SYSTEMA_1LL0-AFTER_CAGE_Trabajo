# El Mac de la sala

El servidor de la web va en tu Mac, Juanlu, el mismo que lleva el Max. Esto es
para que arranque solo, se levante solo si se cae y aguante del 26 al 30 sin
nadie delante. Son unos scripts y una lista de ajustes. Cada ajuste va con su
porqué, pa que sepas qué tocas en tu Mac y por qué te lo pido.

## Instalarlo

1. La carpeta `web` tiene que estar fuera del Escritorio, Documentos,
   Descargas, iCloud o un disco externo, por ejemplo en `~/Systema/web`. macOS
   no deja que un servicio lea esas carpetas sin un permiso que se pide en
   pantalla, y en la sala no habrá nadie para darle a «Permitir».
2. Instala Node, el LTS de [nodejs.org](https://nodejs.org) (22.11 o más
   nuevo). Mejor ese que el de Homebrew, porque va firmado por sus autores y el
   cortafuegos de macOS lo deja entrar sin preguntar.
3. Si la carpeta no trae `node_modules`, haz `npm ci` dentro de `web` una vez,
   con internet.
4. Desde `web`, lanza el instalador con la lista de pantallas de la sala, cada
   una con el mismo nombre que usa el Max en `/tele1/video`.

   ```
   sh sala/mac/instalar.sh --pantallas tele1,tele2,monitor1,monitor2,proyector1,proyector2
   ```

   Deja la web en el puerto 80 (así `http://systema.internal/` va sin número) y
   escucha al Max en el 9100. Si el cortafuegos del Mac está activado y no
   dejaría entrar a los móviles, lo arregla, y para eso te pide la contraseña
   del Mac. Con la lista, el panel te dice qué tele falta aunque no se haya
   encendido nunca.
5. Lanza `sh sala/mac/comprobar.sh` y arregla todo lo que salga con «ojo». Lo
   que sale con «mira» no lo puede ver un script, y lo tienes en la lista de
   abajo.

Puedes volver a lanzar el instalador sin miedo, porque apaga el que hubiera y
pone el nuevo. Si no le dices la lista de pantallas o la clave del panel, se
quedan las de la vez anterior.

Y hay otros dos.

```
sh sala/mac/estado.sh        cómo va: si está en marcha, lo que dice el servidor y lo último del registro
sh sala/mac/desinstalar.sh   quitarlo (el registro se queda en ~/Library/Logs/Systema/)
```

Para abrir el panel desde el móvil de quien abra la sala, instala con una
clave de letras, números, `_` y `-`, de 12 como poco. Sería
`sh sala/mac/instalar.sh --clave-panel unaclavelarga`, y luego
`http://systema.internal/panel?clave=unaclavelarga`. Sin clave, el panel solo
se abre desde el propio Mac.

Las pantallas que van por cable a este Mac se abren solas con
`sh sala/pantallas/mac.sh --instalar tele1 tele2`, cada una con su nombre del
Max. Lo cuenta `sala/pantallas/README.md`, que vale también para el de 2018.

## Antes de dejarlo solo

Todo esto se cambia en Ajustes del Sistema y se puede deshacer al acabar la
expo. `comprobar.sh` mira lo que puede.

- La tapa, abierta. `caffeinate` evita que el Mac se duerma por estar
  quieto, pero no por cerrar la tapa (lo dice Apple en su documentación para
  desarrolladores). Con la tapa cerrada, en cuanto se apagan o se desenchufan
  las pantallas de fuera, se duerme y la sala se queda sin servidor. Si
  molesta la luz, baja el brillo.
- Enchufado, y en Batería > Opciones, «Impedir que el Mac entre en reposo
  automáticamente si está conectado a un adaptador de corriente cuando se apaga
  la pantalla». Es una segunda capa por si el servidor se para.
- Modo de energía Automático, con la batería y con el adaptador
  (Batería > Modo de energía). En bajo consumo todo va más lento.
- En Pantalla de bloqueo, pon en Nunca «Iniciar el salvapantallas cuando el
  ordenador esté inactivo», «Apagar la pantalla cuando el ordenador esté
  enchufado a la corriente y permanezca inactivo» y, si te deja, «Solicitar la
  contraseña después de que se inicie el salvapantallas o se apague la
  pantalla». El salvapantallas y el bloqueo llevan su propio reloj, aparte de
  lo que hace `caffeinate` (Apple, soporte mh11784), y un salvapantallas tapa
  lo que pone el Max.
- En Privacidad y seguridad, pon «Permitir que se conecten los accesorios» en
  «Permitir siempre». En un portátil con chip de Apple, si lleva 3 días
  bloqueado, un accesorio que se desenchufe y vuelva (el adaptador de las
  pantallas, la interfaz de audio, el de red) puede no volver a funcionar hasta
  que alguien lo desbloquee (Apple, soporte 102282).
- Para que el patch se abra al iniciar sesión, en General > Ítems de inicio y
  extensiones añade tu `.maxpat` a «Abrir al iniciar sesión». Así, tras un
  reinicio, el Max vuelve con el patch abierto. Ojo, si alguien deja pulsada
  Mayúsculas al entrar, no se abre (Apple, soporte mh15189). En esa misma
  pantalla, en la parte de lo que funciona en segundo plano, tiene que estar
  activado «caffeinate», que es el servidor.
- Por la licencia del Max, ábrelo con internet los días antes del montaje. La
  suscripción mensual pide conectarse cada 30 días y la anual o la permanente
  cada 180 (Cycling '74). Sin autorizar sigue ejecutando patches, pero no
  guarda.
- Mira que el Max no se duerma. En el montaje, abre Monitor de Actividad >
  Energía y busca la columna «App Nap». El Max tiene que salir con «No». Si
  suena o es la app de delante no debería pasar, pero si solo manda OSC desde
  una ventana tapada, macOS le puede frenar los temporizadores.
- Apaga las actualizaciones automáticas (General > Actualización de software)
  y no pases a macOS 27 hasta después de la expo. Si hay alguna menor
  pendiente, instálala con tiempo para volver a probarlo todo. En la sala no
  hay internet y no se instala nada, pero si se actualiza antes estaríamos
  probando en un sistema distinto del que va allí.
- La red, mejor por cable al router y con la IP reservada en el router (lo
  cuenta `sala/router/`). Tu MacBook no tiene puerto de red, así que hace falta
  un adaptador USB-C a Ethernet. Si al final va por Wi-Fi, en los detalles de
  la red de la sala pon «Dirección Wi-Fi privada» en Fija o Desactivada antes
  de reservar la IP, y no le des a «Olvidar esta red» después, porque si cambia
  esa dirección, cambia la IP (Apple, soporte 102509).
- El cortafuegos lo deja bien el instalador. Si tienes activado el modo
  encubierto, te avisa. Ese modo no rompe nada, pero los iPhone tardan unos 3 s más en
  abrir la web la primera vez, porque Safari prueba antes `https` y el Mac no
  le contesta. Para quitarlo durante la expo, en Ajustes del Sistema > Red >
  Firewall > Opciones, desmarca «Activar modo encubierto».

### Después de un reinicio (esto hay que hablarlo)

El servidor y el Max solo arrancan con tu sesión iniciada. Si el Mac se
reinicia solo (un corte de luz más largo que la batería, un fallo), con
FileVault activado se queda en la pantalla de la contraseña y no arranca nada
hasta que alguien la escriba (Apple, soporte mchlp1158). Hay dos salidas.

- A. Durante la expo, quitar FileVault y poner en Usuarios y grupos «Iniciar
  sesión automáticamente como» tu usuario. Al acabar se vuelve a poner. Antes
  conviene mirar que no haya nada delicado en el Mac.
- B. Dejar FileVault y que quien abra la sala cada día tenga la contraseña.

Es tu Mac, así que lo decides tú. Yo iría por la B si alguien de la sala se
puede encargar. Para un reinicio que hagas tú a propósito existe
`sudo fdesetup authrestart`, que se salta el desbloqueo de FileVault una vez,
pero se queda en la ventana de inicio de sesión, y hasta que alguien entre no
arrancan ni el servidor ni el Max.

## Comprobar que funciona de verdad

`comprobar.sh` y `estado.sh` miran el servidor desde el propio Mac, y eso no
demuestra que lleguen los móviles. La prueba buena es coger un móvil conectado a
la Wi-Fi de la sala, abrir `http://systema.internal/` y tocar una palabra. Lo de
la red (nombre, IP reservada, móviles con datos) está en `sala/router/`.

Que el Max está mandando se ve en el panel (`http://localhost/panel`), en «lo
que llega de max». `/health` solo dice en qué puerto escucha el servidor, no
si le llega algo.

## Qué deja instalado

- El fichero `~/Library/LaunchAgents/es.systema.servidor.plist`, que arranca
  `caffeinate -dims node server/index.js` al iniciar sesión. Si el servidor se
  cae, lo vuelve a levantar a los 5 s. Va como proceso interactivo, para que
  macOS no lo frene por ir en segundo plano, y sin tope duro de ficheros
  abiertos. Node sube él solo su límite hasta el que deja macOS (cada móvil y
  cada pantalla es una conexión, y cada vídeo que se sirve, un fichero).
- Las variables `PORT` (80) y `OSC_PORT` (9100), y si se dicen, `PANTALLAS` y
  `PANEL_CLAVE`.
- El registro, en `~/Library/Logs/Systema/servidor.log`. Si pasa de 20 MB, al
  volver a instalar se guarda aparte.
- El puerto 80 no necesita permisos de administrador. Desde Mojave, macOS deja
  abrirlo a cualquier programa si escucha en todas las direcciones, que es lo
  que hace el servidor. Lo confirmó Apple en sus foros de desarrolladores, y
  lo he probado en macOS 26.7.

## Lo que no está probado

- Nada de esto se ha probado en tu Mac (macOS 15.1). El instalador y
  `comprobar.sh` los he probado en el mío, con macOS 26.7. Instalé, volví a
  instalar, comprobé la validación de la lista y la clave y el cortafuegos
  activado con node firmado, y desinstalé sin dejar rastro.
- Que el instalador arregle el cortafuegos con `sudo` lo he probado con un
  cortafuegos de mentira, no con el de verdad, para no tocar el de mi Mac.
- Si la pregunta del cortafuegos sale al ponerse a escuchar o con el primer
  móvil, no lo dice Apple. Por eso el instalador lo deja arreglado antes.
- Tampoco dice si `caffeinate` frena también el salvapantallas, y por eso va
  en la lista, en Nunca.
- Qué ventanas enseña el Max al arrancar solo (licencia, bienvenida) y si
  frenan que se abra el patch. Hay que probar un reinicio completo en el
  montaje.
