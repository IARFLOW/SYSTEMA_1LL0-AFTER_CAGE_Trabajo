# Web del público · Systema 1LL0~ After Cage

Esta es la web que ven los móviles del público, las páginas de las pantallas
fijas de la sala y el servidor que lo une todo con el Max. El público ve un
mapa de conceptos navegable, toca una palabra y ve su vídeo a pantalla completa
en su móvil, y en el mapa de todos se enciende lo que está sonando en la sala.
La he montado como decidí cuando estudié cómo hacerlo, con SVG plano y d3-zoom,
las posiciones calculadas de antemano y todo servido en local, sin nada de
internet. El mismo servidor recibe del Max qué pone cada pantalla y se lo
manda a esa pantalla (lo cuento en «Max y las pantallas de la sala»), y tiene
un panel para quien monta y para quien abre la sala cada día.

## Dirección de arte (la web es una partitura)

La web se comporta como una página de partitura gráfica mecanografiada, en el
registro de vuestro propio documento y de las conferencias que Cage escribía a
máquina.

| Elemento | Por qué |
|---|---|
| Una sola tipografía (Space Mono, dos pesos) | La máquina de escribir no cambia de familia. Y pesa la mitad que dos familias |
| Las palabras son las notas | Cada concepto es su palabra, centrada donde antes iba el punto, en tres tamaños y dos grosores. Lo pedisteis en la reunión del 23-09-2026 |
| Reglas punteadas y marcas de esquina | Enmarcan la pantalla como una página impresa, en vez de tarjetas flotantes |
| Lo que suena se escribe y se borra letra a letra | Se mueve el propio texto, sin cajas que aparecen, «chips» ni píldoras |
| La señal recorre las aristas | `stroke-dashoffset` sobre líneas de 1 px, para que se vea de dónde a dónde va el sonido |
| Cuenta atrás en `0'31"` | La notación con la que Cage titulaba sus piezas |
| Botones de texto subrayado punteado | Se leen como una nota al margen y no como el botón de una app. El área táctil es de 44 px igualmente |
| Un único verde, y solo para lo que suena en la sala | Si el acento está en todas partes deja de ser señal. Lo que se ve en un móvil lleva una segunda tinta, magenta, que pidió Juanlu. Lo escogí porque se distingue del verde también con daltonismo, y el 02-10-2026 Juanlu le dio el ok |

Para esto miré libraries.dev (`beam`, `orbs`), metal.jakubantalik.com,
originkit.dev, reactbits.dev y canvasui.dev. De ahí cogí la idea del haz que
viaja por un borde y de la onda concéntrica, pero lo he hecho con SVG y CSS
míos, sin WebGL ni librerías, porque con 30 móviles a la vez y un vídeo en
primer plano no cabe un shader de fondo.

El panel de la sala va en el mismo registro. Es una hoja de sala
mecanografiada, con una línea por pantalla y las mismas tintas con el mismo
sentido (verde lo que suena, magenta lo que se ve en un móvil, ámbar lo que hay
que arreglar).

## Arrancar

Hace falta Node 22.11 o más nuevo (el LTS de nodejs.org), porque node-osc no
arranca con uno anterior.

```
cd web
npm install          # solo la primera vez
npm run dev          # servidor + simulador de sala en http://localhost:8080
```

- `http://localhost:8080/` → la web del público. En el móvil, con la IP del ordenador, `http://192.168.1.20:8080/`.
- `http://localhost:8080/panel` → el panel de la sala. Enseña cada pantalla con lo que pone y si suena, los avisos, los móviles, los vídeos que faltan y lo que llega del Max (más en «El panel de la sala»).
- `http://localhost:8080/dev` → el simulador de sala. Ahí se elige a mano qué pone cada pantalla y se ve cómo se enciende en todos los móviles abiertos. Con `npm run dev` las pantallas 01-04 las mueve también el azar, así que para elegir a mano sin que se pisen mejor la 05 y la 06, o `node server/index.js --dev` (sin azar).
- `http://localhost:8080/screen/tele1` → la página de la pantalla `tele1`. Hay una por pantalla, con el nombre que use el Max.
- `http://localhost:8080/health` → estado en texto plano.
- `npm run max` → un Max de prueba que manda la escena de ejemplo del patch de Juanlu.
- `npm test` → 114 pruebas del Max, las pantallas, los móviles, el panel, los carteles, el layout, las versiones y los arrancadores de pantallas, contra un servidor de verdad en puertos libres. Las de navegador usan Chrome sin ventana, las de vídeo ffmpeg y las del arrancador de Windows PowerShell 7 (`pwsh`), y si no están, se saltan solas.

`npm start` arranca como en la sala, sin simulador. Ahí `/dev` y su API no
existen, porque cualquiera en la Wi-Fi de la sala podría encender conceptos a
mano. En la sala tampoco se arranca a mano, de eso se encarga
`sala/mac/instalar.sh` (lo cuento en «El Mac de la sala»).

Tocar un concepto en un móvil pone el vídeo solo en ese móvil, como pide
vuestro documento («la reproducción del público es individual»). Lo que ven
todos a la vez es el verde, que es lo que ponen las pantallas de la sala, y el
magenta, que es lo que alguien está viendo en su móvil.

### Verla sin instalar nada

`npm run demo` genera `web/docs/demo.html`, que es toda la web en un solo
fichero con la sala simulada dentro. Se abre con doble clic o se manda al móvil
por AirDrop. Como no lleva la carpeta `media/`, pone siempre el «clip
simulado».

## Cambiar conceptos y relaciones (sin tocar código)

1. Editar `data/conceptos.csv` (`id,etiqueta,archivo,duracion,numero`, y si se quiere `nivel`, `seccion`, `proceso` y `medio`) y `data/relaciones.csv` (`origen,destino`). `numero` es el número con el que el Max pide ese vídeo a una pantalla (`/tele1/video 3`). Tiene que ser un entero desde el 1 y sin repetir, porque el 0 es negro. En la hoja de ejemplo van del 1 al 50 por orden. Un concepto sin número sale en el mapa igual, pero ninguna pantalla lo puede poner. `nivel` dice el tamaño de la palabra. El 1 son los conceptos principales (los más grandes, en negrita), el 2 los secundarios (en negrita) y el 3 el resto. Sin esa columna el nivel sale de las relaciones, y los 8 conceptos más conectados son de nivel 1 y los 16 siguientes, de nivel 2. Si se usa, lo que se deje vacío es nivel 3.
   Valen tal como los guarde Excel, Numbers o LibreOffice. Pueden ir con comas o con punto y coma (Excel en español usa punto y coma), con comillas, en UTF-8, UTF-16 o la codificación antigua de Windows o de Mac, y con las columnas con o sin tilde («Nº vídeo» o «duración (s)» también valen). La duración se puede escribir como salga, `1:30`, `45s`, `2m30` o `1 min` (y `1,30` lo lee como 1:30, avisando). Las relaciones se pueden escribir por id o por etiqueta.
2. `npm run layout` → recalcula las posiciones con d3-force y escribe `public/map.json` y `public/contents.json`. Cada palabra se coloca con una caja de su tamaño real, así que ninguna pisa a otra (en Space Mono cada letra mide 0,612 em, y el ancho se sabe sin navegador). Si algo no cuadra, lista todos los errores de una vez, cada uno con su línea, y no toca el mapa que había. También avisa de lo que antes pasaba en silencio, como columnas que no conoce, etiquetas repetidas o celdas vacías en las relaciones.
3. Recargar la web. Al servidor no hace falta reiniciarlo, y los móviles que estén abiertos recargan solos cuando cambia la hoja.

La hoja también se rellena sola con el nombre de cada vídeo (20-10-2026, para
no escribir lo mismo dos veces con los 80 audios de Juanlu). Un vídeo de
`media/`, o de sus versiones, que se llame `número_Etiqueta_Sección_Proceso`
(`101_Piedra_T0_G.mp4`) y no esté en la hoja se añade al final de
`conceptos.csv` al pasar el layout, con el 101 en `numero`, Piedra en
`etiqueta`, T0 en `seccion` y G en `proceso`. Luego se le puede poner a mano el
`nivel` o el `medio`.

- La etiqueta puede llevar espacios y tildes (`102_Cámara anecoica_T1_F`), pero no `_`, que es lo que separa las partes. La sección y el proceso pueden faltar (`103_Gota`).
- Las filas que ya están no se tocan, porque manda la hoja. Un vídeo cuyo número ya tiene otra fila no se añade, y se avisa.
- La fila nueva va como la guardó su programa, con el mismo separador, los mismos saltos de línea y la marca de UTF-8 si la llevaba. Si faltan columnas, se añaden al final de la cabecera.
- Con la hoja abierta en Excel o en Numbers, al guardarla después se perderían las filas nuevas. Se cierra antes de pasar el layout.

Las relaciones también salen solas de tres columnas de `conceptos.csv`, `seccion` (T0, T1…), `proceso` (golpe, gota/rebote, ciclo…) y `medio` (audio, vídeo, texto…). Al pasar el layout se unen los que comparten algo, sin unirlos todos con todos. Cada concepto se une con 2 de su grupo, o con los que digas en `npm run layout -- --enlaces 3`. Si a alguno le toca quedarse sin ninguna, se une con el que menos lleve, aunque ese pase de 2. Cuáles se unen lo decide una huella de cada pareja y no el azar, así que con la misma hoja sale siempre el mismo mapa. Una celda puede llevar varios separados por comas («golpe, ciclo», y si la hoja va con comas, entre comillas, que Excel y Numbers ya las ponen), la barra va dentro del nombre («gota/rebote» es uno), y mayúsculas y tildes dan igual. Si uno es el único de su grupo te lo avisa, por si es una errata. En el mapa, las de la sección van continuas, las del proceso discontinuas y las del medio punteadas. Las de `relaciones.csv` siguen valiendo para unir dos a mano, van continuas y ganan si la pareja ya va unida por otra cosa, que ninguna se pinta dos veces. Al colocar las palabras, la sección es la que más junta, y cada una sale como una isla. El proceso junta menos y el medio casi nada, porque une palabras de todas las secciones y apelotonaría el mapa. Encendida, cualquier línea lleva la señal que corre por encima.

Las posiciones también se pueden poner a mano, de dos maneras. Con columnas
`x` e `y` en `conceptos.csv` (en el lienzo de `map.json`, que mide 1400 × 2000
como poco y más si las palabras no caben), o retocando `map.json` y lanzando
`npm run layout -- --keep`. En los dos casos lo fijado no se mueve ni un punto
y solo se colocan los conceptos nuevos, junto a sus vecinos. Si lo fijado no
cabe, el lienzo crece en vez de dejar palabras fuera.

## Los vídeos

Los MP4 van en `media/` (no se versionan). El servidor los busca ahí en vivo,
así que basta con copiar un vídeo a `media/`, sin volver a pasar el layout ni
reiniciar nada. Lo mira al arrancar y cada vez que algo cambia (como mucho una
vez por segundo), sin fijarse en mayúsculas ni en cómo guardó la tilde el
Finder, y la duración la lee del propio MP4. Si en la hoja pone
`Video_01.mp4` y el fichero se llama `video_01.mp4`, lo encuentra. El panel y
`/health` dicen qué conceptos se han quedado sin su vídeo. (Hasta el
01-10-2026, `contents.json` se quedaba con lo que había en `media/` en el Mac
donde se pasó el layout, y la sala habría puesto el clip de pruebas.)

Un vídeo que se está copiando no cuenta hasta que lleva 5 s sin cambiar. Sin
esa espera se servía a medias, y los móviles recargaban la página en cada
latido mientras durara la copia. Al acabar, aparece en unos segundos. En un MP4
fragmentado (el «MP4 fragmentado» de OBS, por ejemplo) la cabecera no dice la
duración entera, y ahí manda la de la hoja. Un enlace roto en `media/` cuenta
como un vídeo que falta.

Las versiones de cada aparato las saca `npm run versiones` de los masters que
pongáis en `masters/`, con el perfil que elegí (H.264 hasta el nivel 4.1, AAC,
un fotograma clave cada 2 s y el índice al principio, para que un móvil empiece
a verlo sin bajárselo entero). Salen tres.

| Versión | Tamaño | Tasa (lo más difícil) | Quién la pone |
|---|---|---|---|
| `media/movil` | hasta 1280 × 720 | unos 2,2 Mbps | los móviles del público |
| `media/tablet` | hasta 1920 × 1080 | unos 5 Mbps | iPads y tablets fijas, por Wi-Fi |
| `media/monitor` | hasta 1920 × 1080 | unos 7,8 Mbps | teles con Raspberry y ventanas del Mac |

El tope lo pone la Wi-Fi, no la potencia del aparato. Por encima de 30 fps se
dividen entre un entero (60 → 30, 50 → 25), porque el nivel 4.1 no admite 1080
a más de 30 y dividir entre un entero no da tirones. Un master que solo es
audio sale como MP4 con la imagen en negro. Lo vertical sale derecho, y se
quitan los metadatos (en un vídeo de móvil va dónde se grabó). El volumen no se
toca, y el informe dice el de cada master por si alguno se exportó muy bajo o
muy alto. Hace falta ffmpeg, y si se lanza otra vez solo rehace lo que ha
cambiado. Cada aparato coge su versión solo, y si no la hay, la del vídeo tal
cual.

Cada dirección lleva una huella (`?v=…`) que cambia al sustituir el fichero.
Los móviles guardan cada vídeo un mes, y sin ella un MP4 corregido con el mismo
nombre no le llegaría a quien ya vio el anterior.

Con `npm run dev`, una palabra sin vídeo abre un «clip simulado» de su misma
duración, para poder probar sin los vídeos. En la sala (sin `--dev`) no se abre
nada. El móvil escribe abajo ««Silencio» no tiene vídeo» y no se enciende en el
mapa de nadie. Ese texto es provisional, porque qué pasa al tocar una palabra
sin vídeo lo decidís vosotros.

## Max y las pantallas de la sala

Esto es lo que acordamos Juanlu y yo el 24 y el 25-09-2026. El Max manda OSC
por UDP a un solo puerto, el 9100, y cada mensaje dice a qué pantalla va.

| Mensaje del Max | Qué hace el servidor |
|---|---|
| `/tele1/video 3` | la pantalla `tele1` pone el concepto con `numero` 3, que se enciende en verde en todos los móviles |
| `/tele1/video 0` | `tele1` en negro, y se apaga su verde |
| `/scene 1` | lo apunta y lo enseña en el panel, nada más |
| `/sound …`, `/light …` | nada, son del Max para los altavoces y la luz de la sala |

- Una pantalla nueva es una línea más en el Max (`/tele3/video 5`), no un puerto nuevo. El nombre es libre (letras, números, `_` y `-`), y da igual en mayúsculas o en minúsculas.
- Cada mensaje es un disparo, así que el mismo número otra vez vuelve a empezar el vídeo.
- Si el Max no manda el 0, el verde se apaga solo cuando acaba el vídeo. Al acabar, la pantalla se queda en negro y no repite.
- Un número que no está en la hoja deja la pantalla en negro y lo apunta en el registro. Una dirección que no entiende, como una errata en el patch, la apunta una sola vez.
- Con la lista de pantallas de la sala (`PANTALLAS=tele1,tele2,monitor1,monitor2,proyector1,proyector2`, que pone el instalador del Mac), si el Max manda a un nombre que no está en ella, el panel lo avisa, porque suele ser una errata (`/tel3/video`) y esa tele se quedaría en negro.
- Por defecto solo acepta mensajes de este mismo ordenador (`127.0.0.1`), porque en la sala el Max y el servidor van juntos en tu M4. Si el Max va en otro ordenador, se arranca con `OSC_HOST=0.0.0.0 npm start`, y para otro puerto está `OSC_PORT`.
- Si el 9100 ya lo tiene otro programa, el servidor lo dice al arrancar, en el panel y en `/health` (`osc SIN PUERTO`), en vez de repartirse con él los mensajes sin avisar. Lo vuelve a intentar cada 10 s, y en cuanto el otro lo suelta lo coge sin reiniciar nada.

Si el servidor se reinicia, las pantallas siguen. Lo que pone cada una se
guarda en `estado/pantallas.json` en cuanto cambia, y al arrancar se recupera
lo que no ha acabado, así que cada pantalla que reconecta sigue con su vídeo
por donde iba. Cada disparo lleva un número único (antes, dos en el mismo
milisegundo, de un bundle, eran el mismo) y «por dónde va» se mide con un reloj
que no salta si cambia la hora del Mac.

### Cada pantalla abre su página

Cada aparato abre en su navegador `http://systema.internal/screen/tele1` en la
sala (o la IP del Mac), con el mismo nombre que usa el Max. Pone lo que le
llega a pantalla completa y sin cursor, y se queda en negro cuando no pone
nada. Si se abre o se reconecta a mitad de un vídeo, entra por donde va. Las
que ponen el mismo vídeo van clavadas. Cada una mide su reloj contra el del
servidor y, si se separa, acelera o frena un poco hasta volver, o salta si se
ha ido más de 0,3 s, así que la que tarda en cargar o se atasca a mitad no se
queda detrás. En Chrome, con una de dos cargando 1,5 s tarde, quedaron a entre
0 y 20 ms en diez rondas (20-10-2026). Cada una va con la hora de su disparo,
así que los mensajes del Max para varias pantallas tienen que salir a la vez,
en la misma línea de la coll o en un bundle. Si se
corta la Wi-Fi, lo que está poniendo sigue, avisa abajo a la izquierda y
reconecta sola. Se recupera sola de un vídeo atascado o de un error de red,
también si la red falla justo cuando el Max dispara (reintenta mientras dure el
vídeo). No enseña rutas técnicas al público (se las cuenta al servidor) y coge
su versión del vídeo, `tablet` en lo táctil y `monitor` en lo demás
(`?version=movil` lo cambia a mano).

- En un iPad, una tablet o un móvil hay que tocar la pantalla una vez al encenderla (el «toque diario»), porque sin un toque ningún navegador deja sonar un vídeo. Hasta entonces pone los vídeos sin sonido y lo pide abajo a la izquierda, y el panel dice «sin activar». El mismo toque la pone a pantalla completa. Una recarga lo olvida, también la que se manda desde el panel, y después hay que volver a tocarla. En el iPad, sin HTTPS una web no puede impedir que la pantalla se apague, así que el Bloqueo automático va en «Nunca» en Ajustes > Pantalla y brillo y también en los ajustes de Acceso guiado, que tiene el suyo (Apple, soporte 111795). Con Acceso guiado nadie se sale de Safari. Se empieza con un triple clic en el botón de inicio, y para salir hace falta su código. El modo de bajo consumo tiene que ir apagado, porque con él el iPad se bloquea a los 30 s.
- Las Raspberry van con Chromium en modo quiosco, que suena sin toque. Cómo se prepara cada una está en `sala/raspberry/`.
- Las pantallas por cable a un ordenador (tu M4, el de 2018 o el de Guille) van cada una con su ventana de Chrome a pantalla completa, y las abre solas `sala/pantallas/`, en un Mac o en Windows. Ya arranca Chrome con `--autoplay-policy=no-user-gesture-required`, que si no pediría un clic para sonar. Si alguna la pusiera el Max directamente, el servidor solo necesita su `/teleN/video` para que el mapa se entere.

### El panel de la sala

`/panel` es para quien monta y para quien enciende cada mañana. Esto es lo que
enseña.

- Cada pantalla con lo que pone, cuánto le queda y cómo está cada página abierta (si suena o le falta el toque, si está oculta, si ha fallado algo, su versión y su tamaño).
- Con la lista `PANTALLAS`, las que faltan aunque no se hayan encendido nunca, y cuántas de la lista están conectadas.
- «identificar», que saca el nombre en grande en esa pantalla (para saber cuál es cuál), y «recargar».
- Los avisos, o sea vídeos que un móvil o una pantalla no han podido poner y nombres que no están en la lista.
- Los móviles conectados y lo que se está viendo, los vídeos que faltan en `media/` y lo último que ha llegado del Max, con lo que hizo el servidor con cada mensaje.

Solo se abre desde el propio Mac. Para mirarlo desde un móvil de la red, el
servidor tiene que arrancar con `PANEL_CLAVE` (el instalador lo pone con
`--clave-panel`) y se abre con `/panel?clave=…`.

### Una Wi-Fi a la que entra el público

La red de la sala la puede usar cualquiera que pase por la puerta, así que el
servidor no se fía de lo que le llega. Lo revisé a fondo el 01-10-2026, y esto
es lo que hace.

- Nada de lo que mande un visitante lo tumba. Antes, un solo mensaje `null` por el WebSocket, o uno de más de 4 kB, apagaba la sala entera. Lo comprueban las pruebas de `npm test`.
- Cada IP puede tener como mucho 4 mapas abiertos a la vez (`MOVILES_POR_IP`), 6 pantallas (`PANTALLAS_POR_IP`) y 48 conexiones (`CONEXIONES_POR_IP`, sumando páginas, vídeos y WebSocket). Al pasarse de mapas o de pantallas se cierra el más viejo, no el nuevo, que es el que el visitante tiene en la mano. Cada socket puede mandar 5 mensajes por segundo seguidos, y quien no se presenta en 10 s se corta. Ningún móvil de verdad se acerca a esos números, y con 50 móviles simulados no salta ninguno. Sin el tope de conexiones, un portátil con un script dejaba al servidor sin ficheros que abrir (lo vi el 02-10-2026).
- Lo que provoca la red se apunta en el registro con tope, 60 líneas por minuto y luego cuántas se han callado, y sin caracteres de control. Una inundación llegó a escribir 214 MB en 10 s, que en una noche es el disco entero del Mac.
- Lo que «ve» un móvil se apaga solo al acabar el vídeo, con un margen, aunque el móvil no avise. Así un script no puede dejar el mapa de todos en magenta durante días.
- Desde este mismo ordenador no hay tope por IP, para poder hacer pruebas de carga (`LIMITAR_LOCAL=1` lo activa también aquí).
- `/health` da el detalle (pantallas, las que faltan, móviles, versión, desde cuándo corre, memoria) solo a este ordenador. A los demás, «ok», y con `?pantallas` también qué pantallas tienen su página abierta, que es lo que mira `sala/pantallas/` para abrir otra vez una pestaña caída.
- El simulador `/dev` no está dentro de `public/`, así que en la sala no existe, se escriba como se escriba la dirección.

El registro lleva día y hora en cada línea (`01/10 18:05:03`), y al arrancar
dice versión, Node, PID, fecha y la lista de pantallas. Lo que suena en la sala
se apunta cada vez que cambia. Lo de los móviles va resumido una vez por
minuto. Si el Max manda lo mismo en bucle, se apunta una vez y luego cuántas
veces se repitió.

## La red de la sala

La sala va por HTTP con `systema.internal`. Lo decidí el 01-10-2026, y es
el plan B que tenía pensado cuando estudié cómo montarlo. `.internal` es un
nombre que ICANN reservó para redes privadas y no está en la lista de sufijos
públicos, así que Chrome 154 no avisa ni con él ni con la IP (lo comprobé en su
código el 01-10-2026). No hace falta comprar un dominio ni renovar un
certificado cada 90 días con internet. Se pierde poco. Sin HTTPS no hay Wake
Lock, así que el móvil del visitante se puede apagar mientras mira el mapa (no
durante el vídeo), y el iPad depende de su Bloqueo automático en «Nunca».

- En la sala el servidor va en el puerto 80, para que la dirección no lleve número y quede en `http://systema.internal/`. El router tiene que mandar ese nombre a la IP del Mac. Si el router no deja dar nombres, el QR del mapa va directo a la IP y funciona igual. Qué tiene que permitir el router y cómo se comprueba está en `sala/router/`.
- El riesgo más alto que he encontrado está en Android. Con los datos móviles encendidos, la Wi-Fi sin internet no pasa a ser la red del móvil hasta que se acepta el aviso de «esta red no tiene internet», y mientras tanto el navegador sale por los datos y la web no abre (lo miré en el código de Android). Por eso el primer cartel dice que se acepte el aviso y el segundo, que se apaguen los datos si no abre. Hay que probarlo con un Android de verdad en la red de la sala.
- Al unirse a una Wi-Fi, los móviles hacen sus comprobaciones de conectividad. El iPhone pide `captive.apple.com/hotspot-detect.html` y Android `…/generate_204`. Sin internet nadie contesta, y el iPhone abre una ventanita de portal cautivo. El servidor contesta lo que esperan (también a Windows y Firefox), siempre que el DNS del router mande esos nombres al Mac y el servidor vaya en el 80. Con las de Apple el iPhone debería dar la red por buena, pero no lo he probado. Apple declara esa comprobación también por el 443, y qué hace el iPhone si el 80 contesta y el 443 no, no lo dice nadie. Las de Android no se pueden engañar del todo (su prueba por HTTPS a Google siempre falla sin internet), y falsearlas cambia qué aviso sale, no si sale.
### Los móviles de los músicos

Para las vídeo-partituras del 29-10-2026, cada móvil es una pantalla más, de
`musico1` a `musico10`, y el Max les manda `/musico1/video 3` como a las teles.
Van clavados entre ellos, como las demás pantallas.

`npm run qr-pantallas -- --web http://192.168.0.10/ --musicos 10`, con la IP
del Mac en la sala, deja en `carteles/` una hoja con un QR por móvil, en HTML y
en PDF, y cada QR suelto en SVG. Cada músico escanea el suyo y se le abre su
página. El QR lleva `?version=movil`, así que cada móvil se baja la versión
«movil» de su vídeo, a unos 2,2 Mbps en vez de los 5 de la «tablet» que
cogería solo. Son diez partituras de 20 minutos a la vez y con el público en
la misma Wi-Fi, y para leer en un móvil sobra. Con `--version` se elige otra.
Vale para cualquier pantalla con nombre, como un iPad que hace de tele
(`npm run qr-pantallas -- --web … tele1 monitor2`), y ahí cada aparato elige
su versión. En la hoja de 10 QR, el detector de macOS los lee todos, uno a uno
(20-10-2026).

- Para que el móvil no se apague, mientras espera en negro la página pone debajo un vídeo negro de 10 s en marcha (`public/despierta.mp4`, con una pista de silencio), solo en lo táctil. Chrome no deja apagarse la pantalla con un vídeo en marcha que la ocupe, aunque vaya sin sonido, y la partitura ya lo hace sola. Safari solo si el vídeo tiene sonido y suena, así que en iPhone el negro suena en silencio desde el toque, y sigue debajo si la partitura no tiene sonido. En un móvil de verdad está por probar, así que el bloqueo automático, lo más largo que deje cada móvil.
- Si el vídeo suena, un toque al abrir la página. En iPhone hace falta igualmente, para que no se apague.
- Si el Mac de la sala tiene puesta la lista de pantallas (`PANTALLAS`), los `musico` van también en ella, o el panel avisa de que no están.

- Safari 18.2 o más nuevo prueba primero `https` y, si falla, cae a `http`. Si el Mac rechaza el 443 al momento no se nota. Con el modo encubierto del cortafuegos activado tarda unos 3 s la primera vez (lo avisa el instalador).

### Los carteles

`npm run carteles -- --red SYSTEMA --clave unaclave --ip 192.168.8.10` deja en
`carteles/` los dos carteles del recorrido, en HTML y en PDF (si hay Chrome), y
cada QR suelto en SVG. Fue idea de Juanlu en la reunión del 23-09-2026 que el
cartel sea parte del acceso a la obra, «aquí párate y haz esto».

- El primero une el móvil a la Wi-Fi de un toque con la cámara (formato `WIFI:T:WPA;S:…;P:…;;`, el que leen las cámaras de iPhone y de Android 10 o más nuevo), con la red y la clave escritas, y avisa de que la red no tiene internet.
- El segundo abre el mapa. Lleva el QR grande, la dirección escrita con `http://` delante (escrita sin él, Chrome prueba antes `https` o la toma por una búsqueda) y, con `--ip`, la IP del Mac en letra y en un QR pequeño, que no pasa por el DNS y abre aunque el nombre falle.
- Si el router no deja nombres, con `--web http://192.168.8.10/` el QR grande va a la IP.
- Lo que dicen está en `TEXTOS`, al principio de `scripts/carteles.mjs`, para cambiarlo sin tocar nada más. Los textos son provisionales, los decidís vosotros. El cartel tiene que estar iluminado, porque en una sala a oscuras la cámara no lee el QR.

## Probar sin Max

`npm run max` manda la escena de ejemplo del patch de Juanlu, la coll
`S01_SCENE1`. En ella `tele1` pone el 3 a los 3 s, `tele2` el 7 a los 8 s y
`tele1` pasa a negro a los 23 s. `npm run max -- --bucle` la repite sin parar.
`npm run max -- /tele1/video 3` manda un mensaje suelto, y
`npm run max -- escena.txt`, una coll del Max guardada como texto. Para verlo,
abrir `/screen/tele1` y `/screen/tele2` en dos ventanas, el mapa en el móvil y
el panel, que enseña en directo lo que llega y qué ha hecho el servidor con
cada mensaje.

## Prueba de carga

`npm run carga` lanza móviles de mentira que se portan como el público contra
un servidor de verdad. Abren la página, se conectan, pasean por el mapa, tocan
una palabra y se bajan su vídeo al ritmo al que se ve, y unos cuantos se van y
vuelven. A la vez, un Max de mentira manda vídeos a las pantallas. Por defecto
son 25 móviles durante 2 minutos (`--moviles 50 --minutos 5` para más). Con
`--servidor http://192.168.8.10` se lanza desde otro portátil contra el
servidor de la sala, y así se carga también el router. Para eso el servidor
tiene que arrancar sin los topes por IP (`MOVILES_POR_IP=0 CONEXIONES_POR_IP=0
PANTALLAS_POR_IP=0`), porque todos los móviles de mentira salen de la misma IP.

Lo medí el 01-10-2026 en mi Mac con 100 móviles. Desde que el Max manda
`/teleN/video` hasta que la palabra se enciende en cada móvil pasan 103 ms (110
el peor), con 0 errores y el servidor al 5,4 % de CPU con 156 MB.

## El Mac de la sala

El servidor arranca solo en tu Mac con `sala/mac/instalar.sh`. Va en el puerto
80, se levanta solo si se cae y no deja que el Mac se duerma.
`sala/mac/comprobar.sh` dice si el Mac está listo para quedarse solo varios
días (tapa, reposo, salvapantallas, FileVault, cortafuegos…), y
`sala/mac/README.md` lo cuenta todo con su porqué. Para las pantallas por
cable, `sala/pantallas/`, para las Raspberry, `sala/raspberry/`, y para el
router, `sala/router/`.

## Estructura

```
web/
├── data/            conceptos.csv, relaciones.csv  ← lo que editáis vosotros
├── media/           los MP4, y media/movil, tablet y monitor con las versiones (fuera de git)
├── masters/         los masters para npm run versiones (fuera de git)
├── scripts/
│   ├── layout.mjs         CSV → map.json y contents.json (d3-force, una vez, fuera del móvil)
│   ├── versiones.mjs      masters → las versiones de cada aparato (ffmpeg)
│   ├── carteles.mjs       los dos carteles con su QR
│   ├── qr-pantallas.mjs   una hoja con un QR por pantalla (los móviles de los músicos)
│   ├── carga.mjs          la prueba de carga
│   ├── max-de-prueba.mjs  un Max de mentira: manda por OSC la escena del patch
│   ├── build.mjs          empaqueta d3-zoom en public/js/vendor.js y copia las fuentes
│   └── demo.mjs           genera docs/demo.html (todo en un fichero, sin servidor)
├── public/          la web tal cual se sirve
│   ├── index.html · css/app.css · js/app.js   el mapa del público
│   ├── screen.html · js/screen.js             la página de cada pantalla (/screen/<nombre>)
│   ├── js/vendor.js (d3-selection + d3-zoom)
│   ├── fonts/       Space Mono 400 y 700 en WOFF2, licencia OFL
│   └── map.json · contents.json   generados por layout.mjs
├── panel/           el panel de la sala (/panel)
├── dev/             el simulador de sala (/dev, solo con --dev)
├── server/index.js  Express 5 + ws + OSC: la web, los vídeos con rango, el WebSocket /ws y el Max
├── sala/
│   ├── mac/         instalar, comprobar, estado y desinstalar el servidor en el Mac de la sala
│   ├── pantallas/   que las pantallas por cable se abran solas, en un Mac o en Windows
│   ├── raspberry/   preparar cada Raspberry
│   └── router/      qué tiene que permitir el router y cómo se comprueba
├── estado/          lo que pone cada pantalla, para seguir tras un reinicio (fuera de git)
└── test/            las pruebas (npm test)
```

## Peso de la página (medido, comprimido)

| Recurso | kB |
|---|---|
| index.html | 2,0 |
| app.css | 6,9 |
| app.js | 15,6 |
| vendor.js (d3-zoom) | 15,8 |
| map.json (50 palabras) | 1,5 |
| 2 fuentes WOFF2 | 32,4 |
| **Total primera carga** | **≈ 74** (el objetivo era < 300) |

Lo medí con `gzip -9` el 02-10-2026 (1 kB = 1024 bytes), y son 76 045 bytes en
total sin contar los vídeos. app.js ha crecido desde el 28-09 (12,8 kB) con lo
que ve el público cuando algo falla, el toque que se queda corto y lo que arreglé el
02-10-2026.

## Qué hace ya

**El mapa**

- Mapa 2D con pan, pinch-zoom e inercia (d3-zoom). Se orienta como un plano de papel, con dos dedos girando en el móvil, el gesto de rotación del trackpad en Safari y Mayúsculas + rueda en lo demás. Las palabras se quedan horizontales. «Centrar» devuelve encuadre y norte en un mismo vuelo, y la web entra con ese vuelo desde lejos.
- Cada concepto es su palabra (28-09-2026, lo pedisteis el 23), en tres tamaños y dos grosores según su nivel. Se entra con la palabra más pequeña a 12 px como poco (en un móvil de 390 px medí 22, 15,5 y 12 px). Lo último tocado queda subrayado, como se subraya a máquina.
- Ninguna palabra pisa a otra. Con los 50 conceptos de ejemplo y con un mapa de 100 conceptos y 168 relaciones salen 0 pisadas. Con el mapa girado, si dos caen una encima de otra, calla la que menos importa (primero lo que suena, luego lo que se ve en un móvil, lo tocado y cada nivel) y vuelve al enderezarlo.
- Lo que suena en la sala se ve con la palabra en verde y la señal recorriendo sus líneas. Abajo, al alcance del pulgar, la línea «en sala» teclea y borra lo que suena (tocar uno vuela hasta su palabra).
- Lo que se ve en un móvil se enciende para todos (28-09-2026, pedido en la reunión del 23), en la segunda tinta y sin movimiento, para que la sala siga siendo lo que se oye. Si algo suena en la sala y en un móvil a la vez, manda la sala. La leyenda va en la cabecera.
- Un toque que se queda corto (a menos de 16 px) abre la palabra más cercana, porque a la distancia de entrada una palabra pequeña mide 15 px de alto.
- Dos temas, oscuro por defecto y claro «papel», con un botón en la cabecera (23-09-2026). Respeta `prefers-reduced-motion` en todo.

**El vídeo en el móvil**

- Un único `<video playsinline>` reutilizado y sin controles. Lleva una línea de progreso de 1 px arriba, la cuenta atrás en `0'31"` y el nombre del concepto (y «también en la sala» si procede), que se retira solo, y al terminar vuelve al mapa. «← mapa», el botón atrás del móvil y Esc cierran el vídeo sin salir de la web, y el mapa vuelve con el mismo encuadre.
- El vídeo arranca dentro del propio toque, con sonido, desde el primer concepto. Pantalla completa de verdad en Android y en iPad. En iPhone no existe para una web, y ahí ocupa el alto útil con las barras de Safari. En Android un solo «atrás» sale de la pantalla completa y cierra el vídeo. Al entrar, Chrome enseña unos 3 s su aviso de cómo salir, con la dirección delante. Es cosa de Chrome y una web no puede quitarlo. El 23-09-2026 decidimos juntos quedarnos con la pantalla completa.
- Bloquear el móvil, cambiar de app o perder la conexión detiene el vídeo. Y no sale la ventanita flotante de Android, que al volver dejaba la página ampliada.
- El servidor late cada 10 s, y 25 s sin oírlo cuenta como conexión muerta aunque el navegador no se entere. Entonces avisa y reconecta solo, con espera creciente (1-2-4-8-10 s).

**Cuando algo falla** (01-10-2026)

- Una palabra sin vídeo no abre nada en la sala y lo dice abajo, tecleado (provisional, lo decidís vosotros).
- Un vídeo que no se puede poner, o que se atasca 15 s, lo dice en vez de cerrarse en silencio, y el servidor apunta cuál para el panel. Mientras carga, el contador lleva el cursor de máquina.
- Sin conexión, el aviso tapa al resto, la señal de las líneas se para y la barra «en sala» se apaga, para no enseñar como vivo lo que no lo está.

**La sala**

- El Max pone vídeos en las pantallas (28-09-2026) y el concepto se enciende en todos los móviles. Las pantallas siguen tras un reinicio del servidor, se recuperan solas y cogen su versión del vídeo.
- El panel `/panel`, con las pantallas que faltan (`PANTALLAS`), «identificar» y «recargar», los avisos y lo que llega del Max.
- El servidor aguanta lo que le mande un visitante, con límites que no nota nadie, y contesta las comprobaciones de conectividad de los móviles.
- El arranque solo en el Mac de la sala (`sala/mac/`), con la comprobación de los ajustes del Mac.
- Las pantallas por cable se abren solas en cada ordenador, en un Mac o en Windows, se reabren si se cierran, y si su pantalla se apaga se cierran y vuelven cuando se enciende (`sala/pantallas/`).
- Los vídeos se buscan en `media/` en vivo, con sus versiones, y `npm run versiones` las saca de los masters.
- Las relaciones salen solas de la sección, el proceso y el medio de cada concepto, en nube y no todos con todos, y cada tipo con su línea (continua, discontinua y punteada).
- Las pantallas con el mismo vídeo van clavadas, con el reloj del servidor, aunque una cargue tarde o se atasque a mitad (20-10-2026, para las vídeo-partituras de los músicos).
- Un móvil o una tablet que espera en negro no apaga la pantalla, con un vídeo negro en marcha por debajo (20-10-2026, probado en Chrome sin ventana, falta en un móvil de verdad).
- Los carteles con su QR, la hoja de QR de las pantallas y la prueba de carga.

**Probado**

- Lo probé en móviles reales el 23-09-2026, con un MP4 de prueba, en un iPhone (Safari) y un Android (Chrome 153). Suena desde el primer toque, «← mapa» y el «atrás» de Android vuelven al mapa en el mismo sitio, girar el móvil conserva el mapa, quitar la Wi-Fi para el vídeo, avisa y reconecta, y bloquear el móvil o salir de Chrome lo para. Con los dos a la vez, lo que se enciende en uno se enciende en el otro al instante. Los gestos ya los había comprobado el 22-09-2026 en iPhone, Android y Windows.
- Lo del Max y las pantallas, con las pruebas de `npm test` y en Chrome con la escena de ejemplo. Abrí una pantalla como si fuera un iPad (sin sonido hasta el toque), otra como una Raspberry (suena sin toque), el móvil y el panel, y congelé el servidor 27 s. En ese rato la pantalla avisa sin cortar lo que pone, y al volver sigue sin empezar de nuevo.
- 114 pruebas en `npm test`, las de navegador con Chrome sin ventana (todas bien el 20-10-2026, las de Windows con PowerShell 7 en el Mac).

Hay capturas en `docs/` (`captura-mapa.jpg` en oscuro, `captura-mapa-claro.jpg`
y `captura-video.jpg`). Son del 22-09-2026, todavía con puntos en vez de
palabras.

## Qué falta (en orden)

1. Probarlo con los aparatos de verdad antes del montaje, o sea tu patch con tu Mac (`sala/mac/comprobar.sh` primero), los iPads (el de 6.ª generación llega a iPadOS 17 y el Air 2 se queda en el 15), una Raspberry Pi 4 con una prueba larga de 2-3 h con el vídeo de verdad, las teles y vuestro router. Y sobre todo un Android con los datos móviles encendidos en la red de la sala, que es el riesgo más alto. Todavía no he probado nada de esto en un iPad, una Raspberry ni un router.
2. Lo que os toca a vosotros. Mandarme los CSV de conceptos y relaciones, los masters y la marca y el modelo de vuestro router, y decidir qué conceptos son de nivel 1 y 2, qué pasa al tocar una palabra sin vídeo, el texto de los carteles y si las pantallas por HDMI las pone el Max o una ventana de Chrome.
3. Decidir qué pasa con tu Mac después de un reinicio. Con FileVault, o lo quitas durante la expo y pones el inicio de sesión automático, o quien abra la sala tiene la contraseña (está en `sala/mac/README.md`).
4. El manual de la sala, con el montaje del 26 y el encendido de cada mañana, en una hoja.
5. Ver con vosotros lo estético, que ahora mismo es si os gusta el vuelo de entrada (1,2 s desde lejos).
6. Más adelante, si hace falta, un canal de vuelta hacia el Max (qué pantallas están vivas) y nombres con huella para el JS y el CSS si algún día se quiere caché larga también ahí (hoy revalidan con ETag, que en red local no cuesta ná).
