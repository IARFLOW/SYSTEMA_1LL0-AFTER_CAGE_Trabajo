# Las pantallas por cable

Cada tele, monitor o proyector que va por cable a un ordenador pone su página
(`/screen/tele1`, `/screen/tele2`…) en una ventana de Chrome a pantalla
completa. Esto las abre solas, cada una en su sitio, y se queda vigilándolas.
Juanlu, va en los tres ordenadores de la sala, tu M4, el MacBook de 2018 y el
portátil de Guille. Los iPads y los móviles fijos no lo necesitan, porque abren
su página en su navegador por la Wi-Fi.

- `mac.sh` para los dos Mac
- `windows.cmd`, con `windows.ps1` al lado, para el de Guille

Ni el de 2018 ni el de Guille necesitan Node ni el resto de la web. Les basta
con Chrome y con esta carpeta. El servidor y el Max van en el M4.

A cada ordenador le dices los nombres de las dos pantallas que lleva
enchufadas, los mismos que usa el Max (tele1, tele2, monitor1, monitor2,
proyector1 y proyector2). En los ejemplos de abajo los he repartido por poner
algo, pero el reparto lo decidís vosotros.

## Qué hace

- Abre un Chrome por pantalla, en modo quiosco (sin barras ni avisos) y sonando
  sin que nadie la toque.
- Las dos ventanas de un mismo ordenador suenan por la misma salida de sonido
  del sistema, así que conviene repartirlas con como mucho una pantalla con
  sonido por ordenador. En el M4 esa salida puede ser la misma interfaz que usa
  el Max.
- Las reparte de izquierda a derecha, según estén colocadas en el sistema. En
  el Mac es Ajustes del Sistema > Pantallas > Organizar, y en Windows,
  Configuración > Sistema > Pantalla. El primer nombre va en la de más a la
  izquierda.
- Deja libre la pantalla del propio portátil, que en el M4 es la del Max. Con
  `--con-integrada` la usa también.
- Si una ventana se cierra, la vuelve a abrir a los pocos segundos.
- Si una pantalla se apaga o se desenchufa, cierra su ventana en cuanto lo ve,
  porque si no el sistema la pasaría a otra pantalla y taparía el Max o la otra
  tele. En cuanto vuelve, la abre otra vez en su sitio, a los 10 o 20 segundos.
- Se acuerda de qué pantalla es cada una, por su modelo y su número de serie en
  el Mac y por el conector en Windows. Así, si al encender falta alguna, las
  demás no se corren un puesto, cada nombre espera a la suya. Y si con todas
  encendidas una no encuentra la suya, porque han cambiado la tele o el cable va
  a otro conector, se queda con la que sobra.
- Mira dónde está de verdad cada ventana. Si el sistema se la ha llevado a otra
  pantalla (pasa si una tele parpadea), o se ha quedado sin ventana con Chrome
  abierto, la devuelve a su sitio. Si a la cuarta no lo consigue, la cierra para
  que no tape otra, lo apunta en el registro y lo vuelve a intentar cuando
  cambien las pantallas.
- Si la página de una pantalla se cae o se queda sin conexión más de medio
  minuto, con Chrome abierto, la abre otra vez. Se lo pregunta al servidor, que
  sabe qué páginas tiene conectadas.
- No abre nada hasta que el servidor contesta.
- Mientras está en marcha, el ordenador no se duerme ni apaga las pantallas.

Dos pantallas iguales, del mismo modelo y sin número de serie (como tantas
teles), no las sé distinguir más que por su orden. Si falta una de las dos, la
que queda se la lleva el primer nombre. Mira con `--ver` en el montaje si dos
salen iguales.

## En un Mac

1. Que esté Google Chrome.
2. En Ajustes del Sistema > Escritorio y Dock, «Pantallas con Spaces separados»
   activado, que viene así de fábrica. Sin eso, una ventana a pantalla completa
   deja en negro las demás. Si está apagado, el script te avisa.
3. Desde la carpeta `web`, mira qué pantallas ve y qué pondría en cada una.

   ```
   sh sala/pantallas/mac.sh --ver tele1 tele2
   ```

4. Pruébalo. En el M4 encuentra él solo el servidor. En el de 2018 hay que
   decirle dónde está, con la IP del M4. Con vuestro router no se le puede
   poner un nombre.

   ```
   sh sala/pantallas/mac.sh tele1 tele2                                en el M4
   sh sala/pantallas/mac.sh --servidor 192.168.1.20 monitor1 monitor2  en el de 2018
   ```

   Se queda vigilando en la terminal, y con Ctrl+C se cierran.
5. Mira en el panel que cada nombre ha caído en su pantalla. Con «identificar»
   sale el nombre en grande en la suya. Si dos están cambiadas, cambia el orden
   de los nombres o muévelas en Organizar, y vuelve a lanzarlo. Cada vez que lo
   lanzas a mano reparte otra vez de izquierda a derecha, y `--ver` enseña lo
   que tiene apuntado de la última vez.
6. Cuando esté bien, instálalo con lo mismo y `--instalar` delante. Desde
   entonces se abren solas cada vez que se inicia sesión, y lo que cuenta va a
   `~/Library/Logs/Systema/pantallas.log`.

   ```
   sh sala/pantallas/mac.sh --instalar --servidor 192.168.1.20 monitor1 monitor2
   sh sala/pantallas/mac.sh --quitar     para quitarlo
   ```

   Al instalarlo, macOS avisa una vez de que «caffeinate» puede ejecutarse en
   segundo plano. Ese aviso es por esto, y en General > Ítems de inicio y
   extensiones tiene que quedarse activado.

Para dejar el de 2018 solo varios días le vale casi toda la lista de «Antes de
dejarlo solo» de `sala/mac/README.md`. La tapa abierta, el salvapantallas y el
bloqueo en Nunca, los accesorios, las actualizaciones y lo de después de un
reinicio. Lo del servidor y el Max es solo del M4.

## En Windows

1. Que esté Google Chrome.
2. Abre la carpeta `web\sala\pantallas` en el Explorador, escribe `cmd` en la
   barra de la dirección y dale a Intro. Se abre una ventana negra ya en esa
   carpeta.
3. Mira qué ve y qué pondría en cada una, y luego pruébalo. Aquí siempre hace
   falta la IP del M4, que el servidor no va en este ordenador.

   ```
   windows.cmd --ver proyector1 proyector2
   windows.cmd --servidor 192.168.1.20 proyector1 proyector2
   ```

   Lo segundo las abre y se queda vigilando, y con Ctrl+C se cierran.
4. Cuando esté bien, lanza lo mismo con `--instalar` delante. Deja un acceso en
   la carpeta de Inicio de Windows, y desde entonces se abren solas cada vez
   que se inicia sesión, sin ventana. Si se cae, se vuelve a lanzar solo a los
   10 segundos. Lo que cuenta va a
   `%LOCALAPPDATA%\Systema\pantallas\pantallas.log`.

   ```
   windows.cmd --instalar --servidor 192.168.1.20 proyector1 proyector2
   windows.cmd --quitar     para quitarlo
   ```

Si Windows pregunta si de verdad quieres abrir `windows.cmd`, porque viene de
internet, dile que sí.

Para saber cuál es la pantalla del portátil se lo pregunto a Windows. Si no me
lo sabe decir, tomo por ella la principal y lo digo en `--ver`. Si el portátil
va con la tapa cerrada y en `--ver` sale una tele como «la del portátil»,
añade `--con-integrada`.

En las opciones de energía de Windows, pon en Nunca que se apague la pantalla y
que entre en suspensión estando enchufado, y el protector de pantalla en
Ninguno. Mientras esto está en marcha ya lo
impide, pero así hay una segunda capa. Si el portátil va con la tapa cerrada,
pon también que al cerrarla no haga nada, porque eso no lo impide y de fábrica
lo suspende. Y pausa las actualizaciones durante la expo, que un reinicio de
madrugada dejaría sus dos pantallas en negro hasta que alguien inicie sesión.

Con la escala de Windows (125 %, 150 %…) Chrome puede abrir la ventana en la
pantalla de al lado. Si pasa, la llevo a la suya, y si no lo consigo, la cierro
y lo digo en el registro. Entonces pon esas pantallas al 100 % en
Configuración > Sistema > Pantalla.

## Comprobar que va

- En el panel del M4 (`http://localhost/panel`) sale cada pantalla con su
  tamaño y si suena. Las de estos ordenadores tienen que salir sonando, sin
  pedir el toque.
- `--ver` dice qué ve el ordenador en ese momento y qué va en cada pantalla.
- En el registro sale todo lo que he cerrado o abierto, y por qué.

## Lo que no está probado

- En mi Mac (macOS 27, Chrome 155) he probado dos a la vez, una en mi monitor y
  otra en la pantalla del portátil. Cada una cayó en la suya y sonaba sin
  toque, y en 40 segundos no se movió ninguna. También que una ventana cerrada
  a la fuerza se vuelve a abrir sola, que se lee bien dónde está cada ventana y
  qué páginas tiene conectadas el servidor, y que `--instalar` y `--quitar`
  funcionan de verdad y no dejan nada. No lo he probado en los vuestros (macOS
  15 en el M4 y 14 en el de 2018), ni con una tele que se apaga y se enciende
  de verdad, ni con un Cmd+W de verdad. Eso, arrancar con una apagada, cambiar
  una tele por otra, una ventana que se va a otra pantalla o se queda sin ella
  y una página que se desconecta los he probado con pantallas y Chrome de
  mentira.
- Lo de Windows no lo he probado en un Windows de verdad. Las pruebas corren el
  script en mi Mac con PowerShell 7, con pantallas y un Chrome de mentira, y
  hace lo mismo que el del Mac. Lo que solo existe en Windows está sin probar,
  que es cómo da las pantallas y cuál es la del portátil, la escala de
  pantalla, llevar una ventana a su sitio, el acceso de Inicio (que va por la
  consola de siempre para que Windows 11 no lo abra en Windows Terminal) y el
  PowerShell que trae Windows, el 5.1.
  Guille, la primera vez mándame lo que sale con `--ver`.
- Cuántos vídeos a la vez aguanta cada ordenador lo dirá la prueba de Juanlu
  con el de 2018.
