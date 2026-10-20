# Systema 1LL0~ After Cage

Aquí está la web pa que la probéis en casa, y tú Juanlu con tu patch!!
Cada vez que cambie algo lo subo aquí.


## Bajarla

- en esta misma página, el botón verde **Code** y luego **Download ZIP**
- lo descomprimís y dentro está todo
- pa tener lo último, lo mismo otra vez (y si usáis git, con un `git pull` vale)


## Lo primero, node

- en nodejs.org le dais al botón de la versión LTS y se instala como cualquier programa
- es solo la primera vez


## Pa arrancarla

- doble clic en `arrancar.command`
- la primera vez tarda un poquito más porque se baja lo que necesita la web, así que tiene que haber internet
- se abre una terminal con lo que va pasando, y en el navegador os salen /panel, /screen/tele1 y /screen/tele2
- mientras probáis dejad la terminal abierta, y pa pararlo la cerráis y listo
- si el mac no os deja abrirlo porque dice que no sabe de quién es (le pasa con todo lo que se baja de internet), id a Ajustes del Sistema > Privacidad y seguridad, abajo del todo sale arrancar.command, le dais a Abrir igualmente y ya no lo vuelve a preguntar
- y si no, también vale abrir la Terminal, escribir `sh` con un espacio detrás, arrastrar arrancar.command a la ventana y darle a Intro


## Con el patch

- tal cual lo tienes Juanlu, mandando a 127.0.0.1 al 9100, que el servidor va en el mismo mac
- cada pestaña de /screen es una tele. la arrastras al monitor que quieras y haces clic una vez dentro, que así suena y se pone a pantalla completa (con Esc sale)
- pa las pantallas por cable de la sala ya no hace falta arrastrarlas, `web/sala/pantallas` abre cada una a pantalla completa en su sitio y la vuelve a poner si se desenchufa y se enchufa otra vez. cómo se usa lo tenéis en su README
- en /panel ves cada mensaje que llega del max y qué ha hecho el servidor con él, así que si algo no cuadra se ve al momento
- ahí también sale cada tele, lo que está poniendo y si suena o le falta el toque, y con identificar sale su nombre en grande en esa pantalla, pa saber cuál es cuál cuando tengas varias
- si quieres poner vídeos a mano sin el max, en /dev eliges qué pone cada tele
- el 0 deja la tele en negro
- el 7 es Ruido y lleva un vídeo de prueba de verdad (es mío y pone clip de prueba, no es material vuestro hahaha), así que en tu S01_SCENE1 la tele2 pone vídeo a los 8 segundos
- el resto de números sale como clip simulado, con la palabra y la cuenta atrás, porque todavía no tengo vuestros vídeos


## Con el móvil

- en la misma wifi que el mac, abrís la dirección que sale en la terminal al lado de «en el móvil»
- lo que pone cada tele se enciende en verde en el mapa, y lo que veis en el móvil sale en magenta en el mapa de todos
- si el mac os pregunta si deja a node aceptar conexiones, decidle que sí


## Verla sin instalar nada

- `web/docs/demo.html` con doble clic, que es la web entera en un solo fichero con la sala simulada dentro, y se puede mandar al móvil por AirDrop
- como no lleva los vídeos, al tocar una palabra sale el clip simulado


## Cambiar palabras y conexiones

- las palabras están en `web/data/conceptos.csv` y las conexiones en `web/data/relaciones.csv`, y se abren con Excel, Numbers o LibreOffice
- cada vídeo lleva en la columna `numero` el mismo número que manda el max, y en `nivel` el tamaño de la palabra (1 las principales, 2 las secundarias y 3 el resto)
- con la web arrancada guardáis la hoja, y en otra terminal, desde la carpeta que os habéis bajado, lanzáis esto

```
cd web
npm run layout
```

- recargáis y ya sale. si algo no cuadra os dice qué falla y en qué línea, y el mapa se queda como estaba
- si no os apetece la terminal, me pasáis las hojas por el grupo o las subís aquí desde la web de GitHub, y lo hago yo
- las conexiones también salen solas si en `conceptos.csv` le ponéis a cada palabra su `seccion` (T0, T1…), su `proceso` (golpe, gota/rebote…) y su `medio` (audio, vídeo…). se unen las que comparten algo, cada una con 2 de su grupo, no todas con todas
- en el mapa las de sección van continuas, las de proceso discontinuas y las de medio punteadas
- si queréis más líneas, `npm run layout -- --enlaces 3`
- una celda puede llevar varios separados por comas, y `relaciones.csv` sigue valiendo pa unir dos a mano


## Si algo falla

- si la terminal dice que el puerto 8080 lo tiene otro programa, cerrad ese programa o arrancad en otro. en la Terminal escribís `PORT=8090 sh` con un espacio, arrastráis arrancar.command y le dais a Intro
- si en /panel, donde pone escucha en, sale SIN PUERTO, es que otro programa tiene el 9100, puede ser algún udpreceive 9100 dentro del max
- y cualquier cosa me escribís por el grupo y lo vemos


## Lo demás

- lo técnico con todo el detalle está en `web/README.md`, por si os pica la curiosidad
- las guías de la sala están en `web/sala`, la de las pantallas por cable (`pantallas/README.md`), la del mac (`mac/README.md`), la del router (`router/README.md`) y la de las raspberry (`raspberry/README.md`), por si al final hacen falta
