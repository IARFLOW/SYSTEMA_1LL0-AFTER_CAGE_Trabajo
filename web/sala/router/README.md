# El router de la sala

No sé qué router tenéis, así que esta guía vale para cualquiera. Sirve para
saber si el vuestro vale, para dejarlo configurado y para comprobar antes de
abrir que todo funciona. Si no vale, al final está el plan B, un GL.iNet
Flint 2.

En la sala, el router hace tres trabajos. Crea la Wi-Fi a la que se une el
público con el QR del primer cartel. Da una dirección (una IP) a cada aparato.
Y, si deja, hace que `systema.internal` lleve al Mac de Juanlu, que es el
servidor. En él van la web del público, las páginas de las pantallas y el Max.
Todo sin internet.

## Lo primero que os pido

Pa saber si vuestro router vale, pasadme estas cosas.

- Una foto de la etiqueta (suele estar debajo) donde se vean la marca, el
  modelo y la versión de hardware, la que pone «Ver.», «V» o «HW».
- Si es de una operadora (Movistar, Vodafone, Orange, Digi…) o lo comprasteis
  aparte. Los menús cambian mucho de uno a otro.
- Si tiene 5 GHz. Si no lo sabéis, con la foto lo miro yo.
- Si podéis, una captura del panel del router, de la parte de LAN o de DHCP.
- Y si La Fábrica de Gomas tiene ya su propia Wi-Fi en la sala, para elegir
  canal.

## Qué tiene que dejar hacer

Lo que decide si vuestro router vale es la 1, la 2, la 3 y la 7. La 4 y la 5
son el nombre. Si no las tiene, el QR lleva la IP y funciona igual (más abajo,
«Si el router no deja nombres locales»). Las demás son ajustes que conviene
hacer.

### 1. La IP del Mac, siempre la misma

Por qué. `systema.internal` apunta a una IP, y las pantallas abren su página
en esa IP o en ese nombre. Si un día el Mac recibe otra, ni los móviles ni las
pantallas llegan. Una reserva hace que el router le dé siempre la misma.

Qué hacer. En el router, una reserva con la dirección MAC del Mac y la IP que
queráis, fuera del reparto del punto 7 si el router deja. La MAC tiene que ser
la que ve el router, que no siempre es la de fábrica.

- Si va por cable, la MAC del adaptador. Es lo que recomiendo si el router
  queda cerca, porque deja la Wi-Fi entera para los móviles. El MacBook de
  Juanlu no tiene puerto de red, así que hace falta un adaptador USB-C a
  Ethernet.
- Si va por Wi-Fi, macOS 15 se presenta en cada red con una «dirección Wi-Fi
  privada», distinta de la de fábrica (Apple, soporte 102509). En una red con
  clave (WPA2 o más) la pone en Fija, que no cambia. En una red abierta, o con
  seguridad débil, la pone en Rotatoria, que cambia cada dos semanas, y la
  reserva dejaría de valer a mitad de la expo. Antes de hacer la reserva,
  mirad que esté en Fija, en Ajustes del Sistema > Wi-Fi > Detalles (junto a
  la red de la sala) > Dirección Wi-Fi privada. Después, no le deis a «Olvidar
  esta red» en el Mac, porque al volver a unirse estrena dirección (el mismo
  artículo de Apple). Y como para el Mac una red con otro nombre es otra red,
  la reserva se hace cuando la Wi-Fi ya tenga su nombre definitivo.

La MAC buena la dice el script de comprobación de más abajo, en la línea «en
la reserva del router va …». A mano, con el Mac unido a la Wi-Fi de la sala,
se saca así.

```
ifconfig en0 | awk '$1 == "ether" { print $2 }'
```

`networksetup -getmacaddress en0` no vale para esto. Da la de fábrica, y con
la dirección privada puesta el router ve otra (lo he medido en macOS 26.7).

Cómo se mira. En el panel del router, la reserva tiene que llevar la MAC que da
el script, y en la lista de aparatos conectados el Mac tiene que salir con la
IP reservada. Si el Mac va por Wi-Fi, esto tiene que dar esa misma IP.

```
ipconfig getifaddr en0
```

Por cable, la IP sale en Ajustes del Sistema > Red, o en el script.

### 2. La Wi-Fi en 5 GHz

Por qué. En la sala habrá hasta 25 móviles a la vez (el aforo que decidimos el
23 de septiembre) bajando vídeo, más las pantallas que vayan por Wi-Fi. En
España, en 2,4 GHz los canales son como mucho de 40 MHz, y en el bloque de
5 GHz del punto 8, de 80 (wireless-regdb, la tabla de frecuencias que usa
Linux). Es el doble de ancho para repartir.

Qué hacer. La Wi-Fi del público, en 5 GHz. Si el router junta las dos bandas
con el mismo nombre, mejor separarlas o apagar la de 2,4 GHz, para que ningún
móvil se quede en la lenta. Antes de apagarla, mirad que todo lo fijo que vaya
por Wi-Fi tenga 5 GHz (la tablet Samsung vieja es la dudosa). Y que el router
aguante a la vez los 25 móviles más las pantallas. Si su ficha dice cuántos
aparatos admite, mejor. Si no lo dice, eso solo se sabe probando con gente, y
con vuestro router no está probado.

Cómo se mira. En el panel del router. Si el Mac está unido a esa Wi-Fi, el
script dice la banda y el canal. En Android, en los detalles de la red suele
salir la frecuencia.

### 3. Que los aparatos se vean entre ellos

Por qué. Algunos routers tienen un aislamiento de clientes. Con él puesto, los
aparatos de la Wi-Fi no se ven entre ellos, y los móviles no llegarían al Mac.
Las redes de invitados existen justo para eso, para que el invitado no vea el
resto de la casa (la de GL.iNet, por ejemplo, es una red aparte de la
principal, según su guía).

Qué hacer. El aislamiento, apagado. El público, en la red principal, nunca en
la de invitados.

Cómo se mira. Con un móvil unido a la Wi-Fi, abrid `http://<IP del Mac>/health`.
Tiene que salir `ok`. Si el script del Mac da todo bien y el móvil no carga,
esto es lo primero que miraría, y después el cortafuegos del Mac
(`sh sala/mac/comprobar.sh`).

### 4. El nombre systema.internal

Por qué. Es la dirección del QR del mapa, y se teclea mejor que una IP. El
final `.internal` está reservado para redes privadas (ICANN, resolución
2024.07.29.06). No existe en internet y no choca con ninguna web de verdad. No
uséis `.local`, que en Android depende de que el móvil lo soporte
(documentación de Android sobre su resolvedor DNS).

Qué hacer. En el router, `systema.internal` apuntando a la IP reservada del
Mac. Y que el router reparta su propia IP como DNS, que es lo normal. Si
reparte otro, como 8.8.8.8, sin internet nadie le contesta y el nombre no
funciona.

Cómo se mira. El script dice «systema.internal lleva a …, que es este Mac». A
mano, se le pregunta al router así (con la IP de vuestro router).

```
dig +short systema.internal @192.168.1.1
```

Tiene que salir la IP del Mac.

### 5. La comprobación de los iPhone

Por qué. Al unirse a una Wi-Fi, cada móvil pregunta a una dirección de su
fabricante si hay internet. El iPhone pregunta a `captive.apple.com` (Apple,
soporte 101555). Sin internet no le contesta nadie, y avisa de que la red no
tiene conexión. Si el router manda ese nombre al Mac, el servidor le contesta
lo que espera y no hay aviso. El servidor ya lo hace, pero no lo he probado
con un iPhone de verdad en una red así. Apple nombra también el puerto 443 para
esa dirección, y qué hace el iPhone si ahí no contesta nadie no lo cuenta en
ningún sitio. Eso hay que verlo en la prueba.

Qué hacer. Si el router deja, `captive.apple.com` apuntando a la IP del Mac,
igual que el nombre del punto 4.

Lo que no puede pasar es que apunte a otro aparato. El iPhone recibiría otra
cosa, creería que es una Wi-Fi de pago y abriría una ventana para «iniciar
sesión». Si alguien pulsa Cancelar, el iPhone se sale de la Wi-Fi (Apple,
soporte 102554). O al Mac, o a ninguna parte.

Las de Android (`connectivitycheck.gstatic.com`) están por decidir. Lo que
recomiendo es no apuntarlas. Android comprueba también por HTTPS con
www.google.com, y eso sin internet no hay forma de imitarlo. Lo único que
cambiaría es qué aviso le sale al visitante.

Cómo se mira. El script dice «la comprobación de los iPhone
(captive.apple.com) llega aquí y recibe «Success»». Y la prueba con un iPhone,
más abajo.

### 6. Sin cable de internet

Por qué. La sala va sin internet a propósito, y todo está pensado y probado
así. Con internet, los móviles se portan distinto de como lo vamos a probar, y
el router podría actualizarse solo en mitad de la expo.

Qué hacer. Nada en el puerto de internet del router, el que pone WAN o
Internet.

Cómo se mira. Si el router tiene internet, el script lo dice
(«captive.apple.com sale a internet»).

### 7. Concesión corta y reparto grande

Por qué. El router presta cada IP durante un tiempo, la concesión. Cada móvil
del público es un aparato distinto y llega con su propia dirección MAC, así
que se queda con una IP hasta que vence su concesión, aunque se haya ido hace
rato. Si se acaban las IP, el siguiente no puede ni entrar en la Wi-Fi.

La cuenta. OpenWrt, en el que se basan routers como el GL.iNet, viene de
fábrica con 150 direcciones y concesiones de 12 h (su guía de DHCP). Con eso,
en cuanto pasan unos 150 móviles distintos en 12 horas, se acaban. Con un
aforo de 25, basta con que la sala se llene y se vacíe seis veces en un día.
Con concesiones de 1 h solo cuentan los de la última hora. Con un reparto de
la .20 a la .250, para llenarlo harían falta más de 200 personas distintas en
una hora, ocho veces el aforo.

Qué hacer. Concesión de 1 h y el reparto más grande que deje el router. En una
red de casa normal (la del router acaba en .1), de la .20 a la .250. La IP del
Mac, fuera del reparto si el router deja, por ejemplo la .10.

Cómo se mira. En el panel del router. El script dice además por cuánto tiempo
le presta el router la IP al Mac, que da una pista.

### 8. Un canal fijo en 5 GHz, sin DFS

Por qué. En España, el único bloque de 5 GHz sin DFS es el de los canales 36 a
48 (solo para interior, que es nuestro caso). En los demás, del
52 al 64 y del 100 al 140, el router tiene que escuchar por si hay un radar
antes de emitir. Tras cada corte de luz la Wi-Fi tarda en aparecer, a menudo
60 s (guía de Wi-Fi de OpenWrt), y si oye un radar se cambia de canal y se
caen los móviles. Del 149 en adelante, en España se emite con 25 mW como mucho,
frente a los 200 del 36 al 48. Con el canal en automático, el
router puede acabar en cualquiera de esos.

Qué hacer. Canal 36 y ancho de 80 MHz. Si no deja elegir el ancho, al menos el
canal.

Cómo se mira. El script, si el Mac está unido a esa Wi-Fi. O en el Mac, con
Opción y clic en el icono de la Wi-Fi, que enseña el canal.

### 9. La contraseña del panel, larga y distinta

Por qué. El público está en la misma red que el panel del router, y cualquiera
puede abrirlo en el navegador. Con la contraseña de fábrica, o con una floja,
alguien podría cambiar la Wi-Fi o el nombre y dejar la sala sin web varios
días, sin nadie allí para verlo.

Qué hacer. Una contraseña larga, que no sea la de la Wi-Fi, que no se imprima
ni se quede en la sala. Y el router fuera del alcance del público, que tiene
el botón de reset y a veces la clave de fábrica en la etiqueta.

### La clave de la Wi-Fi

Está por decidir si la Wi-Fi va con clave o abierta. Lo que recomiendo es con
clave, WPA2 o WPA2/WPA3 mixto (solo WPA3 no lo he comprobado con el QR). El QR
del primer cartel ya la lleva dentro, así que al público no le cuesta nada, y
con clave el Mac usa su dirección privada Fija (punto 1). El nombre de la red y
la clave, con letras y números, sin punto y coma, sin barra invertida y sin
comillas, que alguno lo teclea a mano.

## Cómo se llaman estos ajustes

Cada router los pone en un menú distinto (LAN, DHCP, Wi-Fi, Inalámbrico,
Avanzado…), en español o en inglés. Estos son los nombres que suelen tener.

| Lo que buscáis | Cómo se suele llamar |
|---|---|
| La reserva (1) | reserva de dirección, reserva DHCP, IP estática, IP fija, asignación estática, DHCP estático, address reservation, DHCP reservation, static lease |
| Las bandas (2) | 5 GHz, doble banda, dual band. Si junta las dos con un nombre, band steering o smart connect |
| El aislamiento (3) | aislamiento de AP, aislamiento de clientes, aislamiento inalámbrico, AP isolation, client isolation, wireless isolation |
| La red de invitados (3) | red de invitados, Wi-Fi de invitados, guest network |
| El nombre (4 y 5) | DNS local, DNS estático, hosts, editar hosts, static DNS, local DNS, DNS records |
| El DNS que reparte (4) | servidor DNS o DNS primario, en la parte de LAN o de DHCP |
| La concesión (7) | tiempo de concesión, duración de la concesión, lease time |
| El reparto (7) | rango DHCP, dirección inicial y final, start IP y end IP, pool |
| Canal y ancho (8) | canal, channel, ancho de banda, ancho de canal, bandwidth, channel width |
| DFS (8) | DFS, canales DFS, selección automática de canal |
| La contraseña del panel (9) | contraseña de administrador, contraseña de acceso, admin password |
| La clave de la Wi-Fi | seguridad, cifrado, WPA2-PSK, WPA2-Personal, WPA2/WPA3 |

## Si el router no deja nombres locales

No pasa ná grave. El QR del mapa lleva la IP del Mac en vez del nombre, y
funciona igual. Los carteles se sacan en la carpeta `web`, con vuestra red,
vuestra clave y la IP reservada del Mac (la que da el script).

```
npm run carteles -- --red SYSTEMA --clave unaclave --web http://192.168.1.10/
```

Lo que se pierde es la comprobación de los iPhone (punto 5), así que el iPhone
avisará de que la red no tiene internet. La web debería ir igual, pero qué hace
exactamente el iPhone con vuestro router hay que verlo en la prueba. Todo lo
demás hace falta igual, sobre todo la reserva, porque con la IP en el QR, si el
Mac cambia de IP, el QR deja de valer.

Si el nombre funciona, la IP va también en el cartel, en letra y en un QR
pequeño, por si algún móvil no abre el nombre. Entonces los carteles se sacan
así.

```
npm run carteles -- --red SYSTEMA --clave unaclave --ip 192.168.1.10
```

## La comprobación antes de abrir

Se hace con el router ya en la sala, el Mac en su sitio y el servidor en
marcha. Primero desde el Mac, luego con un iPhone y un Android de verdad, y al
final un corte de luz de mentira.

### Desde el Mac

Se lanza en la carpeta `web`.

```
sh sala/router/comprobar-red.sh
```

No cambia nada ni pide contraseña. De cada cosa dice «ok», «ojo» (hay que
arreglarlo) o «mira» (no se puede ver desde aquí, o depende de vosotros).
Tiene que salir «ok» en el nombre, en la web por la IP y por el nombre, en la
comprobación de los iPhone y, si el Mac está unido a la Wi-Fi de la sala, en la
banda y el canal. Al final dice qué poner en los carteles. Si sale algún «ojo»,
en esta tabla tenéis qué pasa.

| Si dice | Qué pasa |
|---|---|
| el DNS del router no conoce systema.internal | Falta el nombre en el router (punto 4). Si no deja, carteles con la IP. |
| systema.internal lleva a otra IP | El nombre apunta a una IP vieja, o el Mac no tiene su reserva (punto 1). |
| el DNS que reparte el router no contesta | Reparte un DNS de fuera, como 8.8.8.8. Tiene que repartir el suyo (punto 4). |
| el DNS del router no contesta | Mirad que el Mac esté en la red del router de la sala. |
| nadie contesta en http://… | El servidor no está en marcha. Se mira con `sh sala/mac/estado.sh`. |
| contesta otra cosa | Otro programa tiene el puerto 80. |
| este Mac no encuentra systema.internal, aunque el router sí | El Mac tiene un DNS puesto a mano. A los móviles no les afecta. |
| systema.internal no abre la web desde este Mac | El nombre lleva a un sitio donde no está el servidor. Mirad el nombre en el router (punto 4). |
| este Mac tiene systema.internal en /etc/hosts | El Mac lo encuentra por su cuenta, y eso tapa si el router lo sabe o no. |
| no recibe «Success» | La web no está en el 80, o no está en marcha. |
| captive.apple.com lleva a otro aparato | Que apunte al Mac o a nada (punto 5). |
| captive.apple.com sale a internet | El router tiene internet (punto 6). |
| el router no manda captive.apple.com a este Mac | Falta apuntarlo (punto 5). Si el router no deja, se queda así. |
| 2,4 GHz, DFS o poca potencia | Puntos 2 y 8. |
| la Wi-Fi de la sala va sin clave | Ver «La clave de la Wi-Fi». |

Las líneas «mira» dicen la MAC que va en la reserva, por cuánto tiempo presta
el router la IP, si reparte más de un DNS, si el Mac tiene más de una IP y si
la comprobación de Android también llega al Mac (punto 5).

En casa, con otro router, es normal que salgan varios «ojo», porque no está el
nombre y hay internet. Con el servidor en otro puerto, se lanza con
`sh sala/router/comprobar-red.sh --puerto 8090`.

Por si hace falta mirarlo a mano, son estos tres comandos (con la IP de
vuestro router).

```
dig +short systema.internal @192.168.1.1
curl http://systema.internal/health
curl http://captive.apple.com/hotspot-detect.html
```

El primero tiene que dar la IP del Mac, el segundo `ok` y el tercero una
página con `Success`, si se ha apuntado al Mac.

Desde el propio Mac no se ve si el cortafuegos deja pasar a los móviles. Eso
lo mira `sh sala/mac/comprobar.sh`, y del todo, solo un móvil.

### Desde un iPhone y un Android, con los datos móviles encendidos

Es la prueba que más importa, y lo que más puede fallar en la sala es un
Android con los datos encendidos. Mientras la Wi-Fi no tenga internet, Android
sigue sacándolo todo por los datos, y por ahí `systema.internal` no existe
(lo miré en el código de Android). Solo pasa a la Wi-Fi
cuando el visitante acepta quedarse en ella. El aviso sale como notificación
unos 8 s después de unirse. Pone «SYSTEMA no tiene acceso a Internet» y debajo
«Toca para ver opciones». Al tocarla sale «Esta red no tiene acceso a
Internet. ¿Quieres mantener la conexión?», con la casilla «No volver a
preguntar por esta red». Son los textos de Android sin capa (Samsung y otras
marcas pueden cambiarlos). Y no sé si el aviso sale cuando uno se une con el
QR, porque el código solo lo saca si la red se ha elegido a mano.

Hacedla con un iPhone y con un Android, mejor de marcas distintas y con
móviles que no conozcan todavía la red.

1. Datos móviles encendidos. Si el móvil ya conoce la red de la sala,
   olvidadla antes.
2. Uníos con el QR del cartel 1, con la cámara, como lo hará el público.
3. Esperad 10 s y apuntad qué dice el móvil, en las notificaciones y debajo
   del nombre de la red.
4. Escanead el QR del cartel 2. Tiene que salir el mapa. Tocad una palabra y
   tiene que salir su vídeo, con sonido.
5. Si no abre y es un Android, buscad la notificación de «no tiene acceso a
   Internet», tocadla y decid que sí, con «No volver a preguntar por esta red»
   marcado. Probad otra vez y apuntad si así abre.
6. Si sigue sin abrir, apagad los datos móviles y probad otra vez. Así tiene
   que abrir siempre.
7. Probad también la IP escrita a mano, `http://<IP del Mac>/`, con datos y sin
   datos.

Tiene que salir el mapa, por el nombre, siempre con los datos apagados, y con
los datos encendidos como mucho después de aceptar el aviso. En el iPhone,
ninguna ventana de «iniciar sesión» y la primera carga, rápida.

| Si pasa | Qué significa |
|---|---|
| Sin datos abre, con datos no abre ni aceptando el aviso | Es lo de Android y los datos. El cartel ya pide apagarlos. Apuntad marca, modelo y versión de Android. |
| No abre ni sin datos, y el script del Mac da todo bien | El aislamiento (punto 3) o el cortafuegos del Mac. |
| Abre por la IP pero no por el nombre, en todos los móviles | El router no da el nombre a los móviles. Mirad qué DNS reparte (punto 4). |
| Un solo Android abre por la IP pero no por el nombre | Tiene un DNS privado puesto a mano (en sus ajustes de red, «DNS privado» con un nombre de proveedor). Sin internet no le contesta. Por la IP le funciona. |
| El iPhone abre solo una ventana de «iniciar sesión» al unirse | Algo contesta mal a captive.apple.com (punto 5). No pulséis Cancelar, que se sale de la Wi-Fi. Hay que arreglar el router. |
| El iPhone tarda unos segundos la primera vez y luego va rápido | El modo encubierto del cortafuegos del Mac. Safari, desde iOS 18.2, prueba primero HTTPS, y si el Mac no rechaza la conexión al momento espera hasta unos 3 s (WebKit). Se quita en Ajustes del Sistema > Red > Firewall > Opciones > Activar modo encubierto. |
| El iPhone dice que la red no tiene internet, pero abre | Normal si su comprobación no va al Mac (punto 5). |

Apuntad lo que pase con cada móvil (marca, modelo, versión, navegador, si
salió aviso y cuál, y si abrió por el nombre y por la IP, con datos y sin
ellos) y pasádmelo, que con eso cierro el texto de los carteles.

### Un corte de luz de mentira

Desenchufad el router, contad hasta 30 y volved a enchufarlo. Cuando vuelva la
Wi-Fi, mirad tres cosas.

- Que el Mac tiene la misma IP (lo dice el script).
- Que las pantallas vuelven solas (se ve en el panel, `http://localhost/panel`
  en el Mac).
- Que un móvil abre el mapa.

Si la tablet Samsung va por Wi-Fi, al montarla uníos a la red, aceptad el
aviso de «no tiene acceso a Internet» con «No volver a preguntar por esta red»
marcado, y después tocad la red una vez a mano en Ajustes > Wi-Fi. Sin eso,
Android deja de reconectarse solo a una red sin internet, y tras un corte la tablet se quedaría
sin red. Con la capa de Samsung está sin probar.

## El plan B, un GL.iNet Flint 2 (GL-MT6000)

Solo si el vuestro no vale. Según su guía oficial, su panel deja hacer todo lo
de arriba (no lo he probado en uno de verdad).

### El firmware, elegido y congelado

Está por decidir qué versión. Lo que recomiendo es la 4.9.1, la estable desde
el 5 de agosto de 2026. La 4.11.0 salió el 28 de septiembre, y al día siguiente
ya había una 4.11.1 en pruebas (centro de descargas de GL.iNet).

- Ni las «snapshot», que se compilan cada día, ni la 4.9.0 marcada para
  ExpressVPN, ni «Accept Preview Plan» encendido.
- Se instala en SYSTEM > Upgrade > Local Upgrade, con el fichero del centro de
  descargas. Si el router trae una versión más nueva y se baja a la 4.9.1, sin
  marcar «Keep Settings», que GL.iNet pide no marcar al bajar de versión. Si
  trae una más vieja (la 4.8.4 es de abril), se sube.
- El router de repuesto, con la misma versión y la misma configuración. Si no,
  los pasos escritos dejan de valer justo cuando hacen falta.
- Después del ensayo general no se actualiza nada. Sin internet tampoco puede
  actualizarse solo.

### La configuración

Las rutas son las de la guía oficial de GL.iNet (docs.gl-inet.com, la miré en
septiembre de 2026).

1. La primera vez, uníos a su Wi-Fi (el nombre y la clave vienen en la
   etiqueta) y abrid `http://192.168.8.1`. Pide una contraseña de
   administración, que tiene que ser larga (pide 10 caracteres como poco) y
   distinta de la de la Wi-Fi. Luego se cambia en SYSTEM > Security.
2. WIRELESS > Main Network, en la rueda de cada banda. En 5 GHz, el nombre y la
   clave de la sala (WPA2, o WPA2/WPA3), el canal 36 y el ancho de 80 MHz. La de
   2,4 GHz, apagada si nada la necesita. Guest Network e IoT Network vienen
   apagadas, y así se quedan.
3. En NETWORK > LAN, «AP Isolation» apagado. En Advanced, «Lease Time» de 1 h.
   Para unas 900 direcciones, «Netmask» 255.255.0.0 (la única más grande que
   ofrece) y el reparto de 192.168.10.1 a 192.168.13.132. Unas 900 y no más
   porque dnsmasq, el programa que reparte las direcciones, guarda como mucho
   1000 de serie (su manual). La red de invitados de fábrica (192.168.9.x) cae
   dentro, así que tiene que seguir apagada. Esto está sin probar en un
   Flint 2. Si el panel no lo acepta, con 255.255.255.0, el reparto de la .20 a
   la .250 y 1 h también da (la cuenta del punto 7).
4. En NETWORK > LAN > Address Reservation, el Mac en 192.168.8.10. Se elige su
   MAC de una lista, así que el Mac tiene que estar conectado.
5. Edit Hosts es el botón de arriba a la derecha de la página de DNS, que en la
   4.9.x está en NETWORK > DNS y en la 4.11, en DNS. Ahí, `systema.internal` a
   192.168.8.10, y `captive.apple.com` también, si se decide así. GL.iNet dice
   que el router da prioridad a estas reglas. «DNS Rebinding Attack Protection»
   puede quedarse como esté, porque solo filtra respuestas que vienen de fuera
   (manual de dnsmasq), y aquí no hay fuera.
6. APPLICATIONS > AdGuard Home, apagado, que sin internet no sirve de nada. Si
   alguna vez se enciende, repetid el script.
7. SSH viene encendido (SYSTEM > Security). Con la contraseña larga vale, y si
   no se va a usar, se apaga ahí.
8. Nada en el puerto WAN.

Para ver que el reparto ha entrado, se mira por SSH con la contraseña del panel
(sin probar en un Flint 2).

```
ssh root@192.168.8.1 "uci show dhcp.lan"
ssh root@192.168.8.1 "uci -q get 'dhcp.@dnsmasq[0].dhcpleasemax'"
```

El primero tiene que dar la concesión de 1 h (`leasetime`) y un `limit` de
unas 900. El segundo, nada (vale el 1000 de dnsmasq) o un número mayor que el
reparto.

La copia de la configuración para el router de repuesto se saca desde LuCI
(SYSTEM > Advanced Settings > Go To LuCI, y allí System > Backup / Flash
Firmware). También sin probar en un Flint 2.

Y después, todo lo de «La comprobación antes de abrir», igual que con
cualquier router.

## Lo que no está probado

- Nada de esto, con vuestro router ni con un Flint 2.
- El script lo he probado en mi Mac (macOS 26.7) con un DNS de mentira. Ahí
  probé el nombre al Mac, a otra IP y sin contestar, la comprobación de los
  iPhone al Mac y a otro aparato, y la web en otro puerto y con otro programa
  en el puerto. Lo de la Wi-Fi en 2,4 GHz, con DFS y sin clave, lo probé con
  datos de la Wi-Fi de mentira. En el Mac de Juanlu (macOS 15.1), todavía no.
- Qué hace el iPhone si el 80 contesta «Success» y el 443 no contesta.
- Si el aviso de Android sale cuando uno se une con el QR, y si un Android con
  datos llega a la IP sin aceptarlo.
- Si Samsung Internet abre `http://systema.internal/`, que tiene su propio modo
  HTTPS, y Samsung no cuenta cómo trata los nombres locales.
- Si la cámara de un Huawei sin Google se une a la Wi-Fi con el QR. El cartel
  lleva la red y la clave en letra, por si no.
