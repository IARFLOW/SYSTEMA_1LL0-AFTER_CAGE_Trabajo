# Las Raspberry de las teles

Cada Raspberry Pi va detrás de una tele, por HDMI. Al encenderla entra sola en el escritorio, espera a que conteste el servidor del Mac y abre la página de su pantalla, por ejemplo `http://systema.internal/screen/tele1`, a pantalla completa y con sonido. Nadie tiene que tocarla.

Esto es para dejar cada Pi lista en casa (la prepare Juanlu o la prepare yo) y para el día del montaje y cada mañana. Lo he escrito sin tener una Pi delante. Los scripts solo los he probado en el Mac, imitando la Pi, y nada de esto está probado todavía en una Raspberry de verdad. Lo dirá la prueba larga del paso 6.

En esta carpeta hay cinco ficheros.

- `preparar.sh` deja la Pi lista. Se lanza en cada Pi, una vez sin internet y otra con internet.
- `pantalla.sh` es lo que arranca el escritorio. Espera al servidor y abre Chromium.
- `comprobar.sh` dice «ok» u «ojo» de cada cosa.
- `systema.json` son las políticas de Chromium.
- `prueba-larga.txt` es la escena de Max para la prueba larga.

## Qué comprar

La Raspberry Pi 4, no la Pi 5. La Pi 4 tiene decodificador de H.264 y Chromium lo usa. La Pi 5 no lo tiene. Lo único que decodifica por hardware es HEVC y el resto va por la CPU (documentación oficial de Raspberry Pi, página de procesadores), y ese decodificador de HEVC Chromium no lo usa (lo explica un parche de Raspberry Pi en la propia Chromium de la imagen). La Pi 5 podría con el vídeo, pero más caliente, con fuente de 27 W y ventilador, y con más riesgo en cuatro días sin nadie.

Aún no he decidido si la de 2 GB o la de 3 GB de memoria. Me inclino por la de 3 GB, porque con la tarjeta protegida (paso 7) todo lo que se escribe se queda en la memoria hasta que se apaga, y la de 3 GB da más margen. No lo he medido, la prueba larga dirá cuánta usa. El 1 de octubre, en Kubii (distribuidor oficial), había Pi 4 de 3 y de 4 GB. La de 2 GB suelta estaba agotada, aunque quedaban kits de 2 GB. Raspberry Pi ha subido precios tres veces este año (febrero, abril y octubre, en sus noticias oficiales), así que hay que mirarlo el día de la compra.

Cada una lleva esto.

- La fuente oficial de 3 A con USB-C. Nada de cargadores de móvil, que una fuente mala puede estropear la tarjeta (documentación oficial, «Power supplies»).
- Una caja que ventile, mejor con disipadores. Entre 80 y 85 °C la Pi se va frenando (documentación oficial, «Frequency management»), y detrás de una tele hace calor. Si se puede, en vertical, que circula mejor el aire (la misma página).
- Una tarjeta microSD de marca conocida, como pide Raspberry Pi en su white paper «Making a more resilient file system». La imagen ocupa 6,7 GB grabada (lista oficial de Imager), así que una de 16 o 32 GB va sobrada.
- Un cable de micro-HDMI a HDMI. La Pi 4 tiene dos conectores micro-HDMI.
- Un cable de red si llega hasta el router o el switch. Lo que pueda ir por cable, por cable. La Pi 4 tiene red de 1 Gb/s y Wi-Fi de 2,4 y 5 GHz (documentación oficial, página de modelos), así que tampoco impide dejar el router solo en 5 GHz.

Y una o dos Pi de repuesto, preparadas igual que las demás, con su tarjeta grabada.

## Lo que hace falta para prepararlas

- El Mac con Raspberry Pi Imager (raspberrypi.com/software).
- El lector de tarjetas del Mac y un adaptador de microSD a SD.
- Para la primera vez, una tele o un monitor, un teclado y un ratón USB.
- El nombre y la clave de la Wi-Fi de la sala, si las Pi van por Wi-Fi. Si aún no los sabéis, se ponen luego, pero siempre antes del paso 7.
- Un usuario y una contraseña iguales para todas las Pi, que sepamos Juanlu y yo. En los ejemplos uso el usuario `systema`. La contraseña no la apuntéis en el repo.

## 1. Grabar la tarjeta

En el Mac, abrid Raspberry Pi Imager.

1. En Dispositivo, Raspberry Pi 4.
2. En Sistema, «Raspberry Pi OS (64-bit)», el de escritorio. Tiene que poner 2026-09-15. Ni el Lite, que no trae escritorio ni Chromium, ni el Legacy, que es el sistema anterior (Bookworm). Si Imager ya ofrece una fecha más nueva, escribidme antes de seguir, porque con otra imagen viene otra Chromium y las Pi no serían iguales.
3. En Almacenamiento, la tarjeta.
4. En Personalización hay que rellenar varias cosas.
   - En Hostname va el nombre de la pantalla, el mismo que usa Max. `tele1`, `tele2`…
   - En Localisation, Madrid. Pone la hora, el teclado y el país de la Wi-Fi, ES, que tiene que estar bien (documentación oficial, «Configuring networking»).
   - En User, el usuario y la contraseña de todas.
   - En Wi-Fi, la de la sala. Yo la pondría con clave, aunque eso aún está por decidir, y si al final va abierta, «open network».
   - En Remote Access, Enable SSH, con contraseña.
   - Raspberry Pi Connect, no. Necesita internet y en la sala no hay.
5. Escribir.

En casa la Pi no va a encontrar la Wi-Fi de la sala, y mejor, porque así la primera vez arranca sin internet, que es justo lo que queremos.

## 2. Copiar esta carpeta a la tarjeta

Cuando Imager acabe, sacad la tarjeta y volved a meterla. Aparece un disco que se llama `bootfs`. Copiad ahí esta carpeta con el nombre `systema`. Se puede hacer desde el Terminal del Mac, en la carpeta del repo.

```
cp -RX web/sala/raspberry/ /Volumes/bootfs/systema
```

Con la barra del final vale también para volver a copiarla encima. Expulsad el disco antes de sacar la tarjeta.

## 3. Primer arranque, sin internet

Antes de que la Pi tenga internet hay que congelar Chromium. La 151 y la 152 rpt1 colgaban la Pi 4 al acabar un vídeo. La imagen se quedaba congelada y solo se arreglaba reiniciando (raspberrypi/trixie-feedback, issue 101, con varios vídeos a la vez en la página). Lo arregló la 152.0.7977.82 rpt2, que es la que trae la imagen 2026-09-15. Congelada, ni un `apt upgrade` la cambia hasta que acabe la expo.

1. La tarjeta en la Pi. La tele en el HDMI0, el conector de al lado de la USB-C de la corriente (la documentación oficial pide el monitor principal en el HDMI0). Teclado y ratón. Sin cable de red.
2. Enchufadla. Entra sola en el escritorio.
3. Abrid un terminal con Ctrl+Alt+T y lanzad esto, con el nombre de esa Pi.

```
sh /boot/firmware/systema/preparar.sh tele1 http://systema.internal
```

Pide la contraseña de la Pi una vez. Lo primero que hace es mirar la versión de Chromium y congelarla. Al final dice qué ha hecho y qué falta. Sin internet, faltará `overlayroot` (paso 4).

Si lo queréis mirar a mano, son estos dos comandos.

```
dpkg -l chromium
apt-mark showhold
```

La versión tiene que ser `1:152.0.7977.82-1~deb13u1+rpt2` o más nueva, y en la lista de congelados tienen que salir `chromium`, `chromium-common` y `chromium-sandbox`.

Si la imagen trae una Chromium más vieja, `preparar.sh` se para y lo dice. Lo mejor es grabar la tarjeta otra vez con la imagen 2026-09-15. Si no se puede, con internet se arregla así.

```
sudo apt update
sudo apt install chromium chromium-common chromium-sandbox chromium-l10n
sh /boot/firmware/systema/preparar.sh tele1 http://systema.internal
```

Eso instala la última del archivo de Raspberry Pi. El 1 de octubre era la 154.0.8037.57 rpt1, que lleva los mismos parches del arreglo. Y en estas Pi nunca `apt upgrade`, ni el aviso de actualizaciones del escritorio.

## 4. Bajar overlayroot, con internet

La protección de la tarjeta (paso 7) necesita el paquete `overlayroot`, que no viene en la imagen y se baja de internet. Si se intentara en la sala, raspi-config no podría bajarlo y aun así diría que la protección está puesta (lo miré en su código). Por eso se baja ahora.

1. Conectad el cable de red al router de casa.
2. Lanzadlo otra vez, ahora sin nombre ni servidor, porque coge los que ya tenía.

```
sh /boot/firmware/systema/preparar.sh
```

Esta vez instala `overlayroot` y no debería faltar nada. Si falta el sonido, encended la tele y volved a lanzarlo.

3. Si queréis verlo con vuestros ojos, abrid Chromium desde el menú y escribid `chrome://policy`. Tienen que salir `TranslateEnabled`, `AutoplayAllowed`, `DiskCacheSize` y `ExtensionInstallBlocklist`. Cerradlo.
4. `sudo reboot`. Al volver, la tele enseña el escritorio hasta que conteste el servidor, y entonces la página a pantalla completa. En casa no hay `systema.internal`, así que se queda esperando. Es lo normal hasta el paso 6.

## 5. Qué deja `preparar.sh`

Volver a lanzarlo es seguro, porque lo que ya está bien no lo toca. Pide la contraseña solo para lo que es del sistema (desde la imagen de abril de 2026, `sudo` pide contraseña, notas de versión de Raspberry Pi OS). Esto es lo que deja.

- `/boot/firmware/systema.txt`, con el nombre y el servidor. Está en la partición de arranque, la que se ve como `bootfs` en el Mac, para que se pueda cambiar también con la tarjeta protegida.
- `/opt/systema/pantalla.sh` y `/opt/systema/comprobar.sh`.
- `~/.config/labwc/autostart`, que lanza `pantalla.sh` con `lwrespawn`. Es el sitio que usa la guía oficial de Raspberry Pi para el modo kiosk. `lwrespawn` viene en el sistema (paquete rpd-wayland-core) y vuelve a lanzarlo si Chromium se cierra.
- El inicio de sesión automático en el escritorio (`raspi-config nonint do_boot_behaviour B4`).
- Chromium congelada (`apt-mark hold`), también `rpi-chromium-mods`, los ajustes de Raspberry Pi para Chromium.
- Las políticas de Chromium, en `/etc/chromium/policies/managed/systema.json`.
  - `TranslateEnabled: false`. La página está en español y, si Chromium está en otro idioma, podría ofrecer traducirla encima del vídeo. Sin internet no traduciría, pero el aviso sí puede salir. No hay ninguna opción de arranque que lo quite.
  - `AutoplayAllowed: true`. El vídeo suena sin que nadie toque, además de la opción `--autoplay-policy` de `pantalla.sh`.
  - `DiskCacheSize: 104857600`, 100 MB de caché. Con la tarjeta protegida la caché vive en la memoria, y así no crece sin parar.
  - `ExtensionInstallBlocklist: ["*"]`, sin extensiones. Los ajustes de Raspberry Pi para Chromium mandan instalar dos la primera vez que se abre con internet (`/etc/chromium/initial_preferences`), y en esta pantalla no pintan ná.
- `/etc/chromium.d/systema`, para que Chromium no use el llavero (`--password-store=basic`). Desde la imagen de abril de 2026, Raspberry Pi OS une las contraseñas de Chromium con el llavero del sistema (notas de versión del 13 de abril de 2026). Con el inicio de sesión automático nadie lo desbloquea, y puede salir una ventana pidiendo una contraseña que nadie va a escribir (le pasó a otra Pi con inicio automático, faering/jarvis, pull request 236). Ese fichero vale para cualquier Chromium que se abra en la Pi, no solo el de la pantalla.
- El watchdog, en `/etc/systemd/system.conf.d/systema-watchdog.conf`.
- El sonido por el HDMI, en `~/.config/wireplumber/wireplumber.conf.d/50-systema-hdmi.conf`, y la salida al 100 %.
- Sin apagado de pantalla (`raspi-config nonint do_blanking 1`).
- El nombre de la Pi en la red, el mismo que el de la pantalla. Así se entra con `ssh systema@tele1.local`.
- `overlayroot` instalado, sin activar.

No actualiza nada, no toca la Wi-Fi y no protege la tarjeta.

## La línea de Chromium

`pantalla.sh` abre Chromium así.

```
chromium --kiosk --noerrdialogs --no-first-run --password-store=basic \
  --autoplay-policy=no-user-gesture-required --hide-crash-restore-bubble \
  http://systema.internal/screen/tele1
```

- Con `--kiosk` va a pantalla completa, sin barras, y Chromium no enseña ningún aviso al arrancar, tampoco el de restaurar páginas después de un corte de luz. `--hide-crash-restore-bubble` sobra con `--kiosk`. Está por si algún día se quita.
- `--disable-infobars` no está, aunque la guía oficial de kiosk la siga poniendo, porque fuera del modo headless ya no hace nada.
- Antes de abrir Chromium, `pantalla.sh` espera a que el servidor conteste. Pregunta a `/health` cada 2 segundos. Si Chromium abriera antes, se quedaría en su página de error y la reintentaría cada vez más despacio. Si el error dura, la reintenta al segundo, a los 6 s, a los 36 s, a 1 min 36 s, a 6 min 36 s, a 16 min 36 s y luego cada media hora. Mientras espera, la tele enseña el escritorio.
- Si a `systema.txt` le falta el nombre o el servidor, la tele lo dice en gris sobre negro.

Lo que cuenta `pantalla.sh` va al registro del sistema, y se lee con `journalctl -t systema`.

## 6. La prueba larga (2 o 3 horas)

Nadie ha publicado una prueba de horas con la Chromium que vamos a usar. Quien encontró el fallo lo dio por arreglado tras 45 minutos limpios (issue 101). Así que la hacemos nosotros, con vídeos como los de la sala.

Se monta en el Mac de casa.

1. Al menos tres vídeos de verdad en `web/media/`, sacados con `npm run versiones` (la versión `monitor`, de hasta 1920 × 1080, en H.264 y a unos 7,8 Mbps), con los números 1, 2 y 3 en la hoja.
2. Arrancad el servidor con `npm start` en `web/`. Escucha en el 8080. La IP del Mac la da `ipconfig getifaddr en0`. Si en ese Mac ya está instalado el servidor de la sala (`sala/mac`), no hagáis `npm start`, porque ese ya tiene el Max en el 9100 y el nuevo no recibiría la escena. Apuntad las Pi a `http://<IP del Mac>`, sin `:8080`, y mirad en el panel que llega lo del Max.
3. Cada Pi, apuntando a ese servidor. Desde el Mac, por SSH, con el nombre de la Pi y la IP del Mac.

```
ssh -t systema@tele1.local
sh /boot/firmware/systema/preparar.sh tele1 http://192.168.1.20:8080
sudo reboot
```

4. La escena de prueba, en bucle. Pone y quita vídeos en tele1, tele2 y tele3 cada pocos segundos, con negros entre medias, y vuelve a empezar cada dos minutos. Así el decodificador se abre y se cierra cientos de veces, que es justo lo que colgaba la Pi 4.

```
cd web
npm run max -- sala/raspberry/prueba-larga.txt --bucle
```

Si vuestras Pi se llaman de otra manera, cambiad los nombres en `prueba-larga.txt`.

Mientras dura la prueba, id mirando esto.

- La tele, de vez en cuando, que no se congele y que suene.
- En el panel (`http://localhost:8080/panel`, en el Mac) cada tele tiene que decir «suena» y su tamaño, 1920×1080 en una tele Full HD.
- Cada media hora, en cada Pi, `sh /opt/systema/comprobar.sh`. Apuntad la temperatura, la memoria libre y si dice «decodifica por hardware».

Para saber si decodifica por hardware, `comprobar.sh` lo dice cuando hay un vídeo puesto. A mano, `sudo lsof /dev/video10` tiene que enseñar `chromium`. Y en `top`, Chromium tiene que quedar lejos del 150 a 270 % de CPU que medía quien encontró el fallo decodificando por software, según cuánto vídeo tuviera su página (issue 101). Por hardware no hay cifras publicadas, así que apuntad las nuestras.

Para darla por buena, al acabar pido dos cosas.

- Ni una congelación en las 2 o 3 horas.
- En `comprobar.sh`, ningún «ojo» en la temperatura, en la corriente (`get_throttled 0x0`) ni en los mensajes del núcleo.

Y después vienen las pruebas de arranque, una a una.

1. Con el servidor parado, reiniciad la Pi. La tele enseña el escritorio. Arrancad el servidor y a los pocos segundos sale la página.
2. Con un vídeo en marcha, desenchufad la Pi y volved a enchufarla. Tiene que volver sola, sin ventanas de contraseña ni de restaurar.
3. Con la tele apagada, reiniciad la Pi y encended la tele después. Tiene que salir la imagen y sonar. Si no, apuntadlo.
4. Con la página abierta, parad el servidor un minuto. Abajo a la izquierda sale «sin conexión con la sala · reintentando» y el vídeo sigue. Al arrancar el servidor, vuelve sola.
5. Apagad el router un minuto. Lo mismo.

Cuando acabéis, volved a apuntar cada Pi al servidor de la sala.

```
sh /boot/firmware/systema/preparar.sh tele1 http://systema.internal
```

## 7. Proteger la tarjeta (lo último, en casa)

Con el overlay la tarjeta queda en solo lectura. Lo que se escribe va a la memoria y se pierde al apagar (documentación oficial, «Overlay file system»). Así un corte de luz no la estropea, que es lo que propone Raspberry Pi en su white paper. A cambio, tiene tres pegas.

- Cualquier cambio de después, la Wi-Fi, el sonido, todo, se pierde al reiniciar. Por eso es lo último.
- Los registros también se pierden al reiniciar, también los que explicarían por qué se colgó.
- La partición de arranque también queda en solo lectura. raspi-config, sin menús, pone las dos cosas a la vez (lo miré en su código).

Antes, con la tele encendida, lanzad `sh /opt/systema/comprobar.sh`. Tiene que salir todo «ok» menos el overlay, y el servidor si estáis en casa (allí no hay `systema.internal`). El sonido se fija ahora, no después. Luego el overlay se pone así.

```
sudo raspi-config nonint do_overlayfs 0
sudo reboot
```

Al volver, comprobadlo.

```
findmnt /
```

En la columna `FSTYPE` tiene que poner `overlay`. Si pone `ext4`, no está puesto, aunque raspi-config haya dicho que sí. `comprobar.sh` también lo mira («overlay activo de verdad»).

Para quitarlo, por ejemplo para cambiar la Wi-Fi, se hace así.

```
sudo raspi-config nonint do_overlayfs 1
sudo reboot
```

La partición de arranque sigue en solo lectura después de quitarlo. `preparar.sh` la abre y la cierra él solo. Para dejarla como al principio, el mismo comando otra vez, ya sin overlay, y otro reinicio.

Por último, una etiqueta con su nombre en cada Pi y en su fuente.

## El sonido

La Pi saca el sonido por el primer HDMI que encuentra, y si no encuentra ninguno, por el jack o por un USB (documentación oficial, «Change audio output»). Si arranca con la tele apagada, el sonido se podría quedar en el jack. Para que no pase, `preparar.sh` deja una regla para WirePlumber, el que reparte el sonido. La regla hace cuatro cosas.

- Pone las salidas HDMI por delante de las demás, y el HDMI0 por delante del HDMI1. Las salidas normales van de 600 a 1000 y la documentación de WirePlumber pide no pasar de 1500 (WirePlumber 0.5.8, la versión de la imagen).
- No recuerda la salida elegida a mano. Así manda la prioridad, y al encender la tele el sonido debería volver al HDMI (sin probar).
- No deja que la salida se suspenda nunca, tampoco entre vídeo y vídeo.
- Pone la salida al 100 %. El volumen se pone en la tele.

raspi-config ya no sirve para esto, porque con PipeWire dice que no puede. Para verlo a mano, `wpctl status`. En «Sinks», la que lleva el asterisco es la que suena.

Todo esto, antes del overlay y con la tele encendida. Y la tele siempre en el HDMI0.

## Que la pantalla no se apague

- En la Pi, el apagado de pantalla de Raspberry Pi OS es una línea de `swayidle` en el arranque del escritorio, y apaga la pantalla a los 10 minutos sin ratón ni teclado (documentación oficial, «Screen blanking»). `preparar.sh` la quita con `raspi-config nonint do_blanking 1` y comprueba que no queda ninguna, y `comprobar.sh` lo vuelve a mirar.
- En la tele, mirad en su menú si tiene apagado automático o ahorro de energía, y quitadlo. Y mirad qué hace al volver la corriente. Si se queda apagada, habrá que encenderla con el mando cada mañana.

## El watchdog

Si la Pi se cuelga entera (el núcleo o systemd), el watchdog la reinicia a los 14 segundos. systemd lo trae apagado (`RuntimeWatchdogSec=0` en systemd 257) y `preparar.sh` lo enciende.

Lo que no ve es una imagen congelada con el sistema vivo, que es lo que hacía el fallo de Chromium en la Pi 4. El núcleo seguía respondiendo y la pantalla no (issue 101). Eso solo se ve mirando la tele.

## Lo que hace sola

Así está pensada, y las pruebas de arranque del paso 6 lo tienen que confirmar.

- Si se va la luz, la Pi vuelve sola, espera al servidor y abre la página, sin ventanas.
- Si el servidor se cae con la página abierta, la página sigue con lo que ponía, avisa abajo a la izquierda y se reconecta sola, sin recargar.
- Si Chromium se cierra, `lwrespawn` lo vuelve a abrir al segundo.
- Si el sistema se cuelga entero, el watchdog la reinicia.
- Si la Wi-Fi se va y vuelve, pasa como con el servidor.

Y esto no tiene arreglo en la Pi.

- Si se cae la pestaña (la carita triste de Chromium), Chromium sigue abierto y `lwrespawn` no hace nada. En el panel, esa tele deja de salir conectada. Hay que reiniciar la Pi.
- Si la imagen se congela con el sistema vivo, el watchdog no lo ve y el panel puede seguir diciendo que la tele está bien. Solo se ve mirando la tele. `comprobar.sh` lo debería notar («el firmware no contesta» o «la pantalla no se deja capturar»), porque en aquel fallo `vcgencmd` y `grim` se quedaban colgados (issue 101).
- Si la tele se apaga sola, la Pi no la enciende.

## El día del montaje

1. Primero el router y el Mac con el servidor. En el Mac, el panel abierto en `http://localhost/panel`.
2. Cada Pi detrás de su tele, con la tele en el HDMI0, la fuente oficial y el cable de red si llega.
3. Encended las teles y después las Pi.
4. En el panel tiene que salir cada tele con «suena» y su tamaño. Con «identificar», cada tele enseña su nombre en grande, y así se sabe cuál es cuál. El panel también dice la IP de cada Pi.
5. Si una no aparece, mirad «Si algo va mal».

## Cada mañana

1. Router, Mac (con el panel abierto), teles y, al final, las Pi. Si una Pi arranca antes que el servidor no pasa nada, se queda esperando.
2. En el panel, todas las teles conectadas y diciendo «suena».
3. Al cerrar, con la tarjeta protegida, se pueden apagar quitando la corriente.

## Cambiar el nombre o el servidor

Están en `/boot/firmware/systema.txt`, en dos líneas.

```
nombre=tele1
servidor=http://systema.internal
```

Si el router no da el nombre `systema.internal`, se pone la IP del Mac con `http://` delante, como `servidor=http://192.168.8.10` o la que tenga. La IP no depende del DNS del router. La pega es que si un día cambia la IP del Mac, hay que cambiarla en cada Pi. Por eso, si el router da el nombre, mejor el nombre.

Hay tres maneras. Las dos primeras valen también con la tarjeta protegida.

1. Desde el Mac, sin la Pi. Desenchufad la Pi, sacad la tarjeta y metedla en el Mac. En el disco `bootfs`, abrid `systema.txt` con TextEdit, cambiad la línea, guardad, expulsad el disco y volved a meter la tarjeta en la Pi.
2. Por SSH, desde el Mac, con `tele1.local` o con la IP que dice el panel.

```
ssh -t systema@tele1.local
sudo mount -o remount,rw /boot/firmware
sudo nano /boot/firmware/systema.txt
sudo reboot
```

En nano, Ctrl+O e Intro para guardar y Ctrl+X para salir.

3. Sin la tarjeta protegida, también vale `preparar.sh` con el nombre y el servidor nuevos, como en la prueba larga.

Con las dos primeras, el nombre de la Pi en la red (`tele1.local`) se queda como estaba. Solo cambia el de la pantalla.

## Si algo va mal

- Si la tele enseña el escritorio y no la página, la Pi no llega al servidor. Mirad que el Mac está encendido y con el servidor (el panel abre). Desde el Mac, `ssh -t systema@tele1.local sh /opt/systema/comprobar.sh` dice si no encuentra el nombre o si el servidor no contesta. Si no encuentra `systema.internal`, poned la IP (arriba).
- Si la tele enseña un texto gris sobre negro, a `systema.txt` le falta el nombre o el servidor.
- Si la imagen se ha congelado, desenchufad la Pi y volved a enchufarla. Antes, si podéis, lanzad `comprobar.sh` desde el Mac como arriba y guardad lo que diga, porque al reiniciar se pierde.
- Si la misma tele se congela más de una vez, toca el plan B. En `systema.txt`, quitad la `#` de la línea `# decodificar=software` y reiniciad. El vídeo pasa a la CPU. Se acaba el problema del decodificador, pero la Pi calienta mucho más (en el informe del fallo, entre el 150 y el 270 % de CPU, según cuánto vídeo hubiera en la página). Vigilad la temperatura con `comprobar.sh`. Y avisadme, que el plan B no lo hemos probado.
- Si sale la carita triste de Chromium, o el panel dice que no está conectada una tele que está encendida, reiniciad la Pi.
- Si no suena, mirad el volumen de la tele y su entrada, y luego `comprobar.sh`. Si la Pi arrancó con la tele apagada y el sonido no ha vuelto, reiniciadla con la tele encendida.
- Si sale una ventana pidiendo una contraseña, que no debería, apuntad qué dice y reiniciad la Pi.
- Si `comprobar.sh` dice que le falta corriente, es la fuente o el cable. Cambiadlos por los de repuesto.
- Si la tele se apaga sola al cabo de unas horas, es el ahorro de energía de la tele.

## Lo que no está probado

Nada de esto se ha probado aún en una Raspberry Pi. En concreto, falta comprobar esto.

- Que la Pi 4 decodifique nuestros vídeos por hardware con esta Chromium, y cuánta CPU, temperatura y memoria gasta en horas. Es lo que mide la prueba larga.
- Que no salga la ventana del llavero con `--password-store=basic`. Se vio y se quitó así en otra Pi con inicio de sesión automático (faering/jarvis, pull request 236), pero no en las nuestras.
- Que el sonido vuelva al HDMI si la Pi arranca con la tele apagada, y si la salida HDMI existe siquiera sin tele.
- Que la imagen pase a la tele si la Pi arranca con ella apagada. Mientras no hay pantalla, el escritorio usa una de mentira (`LABWC_FALLBACK_OUTPUT=NOOP-1`, en `/etc/xdg/labwc/environment`).
- Si se ve el cursor sin ratón conectado, mientras arranca o en la página de error. La página de la tele lo esconde.
- Cómo va con teles 4K. Mirad en el panel qué tamaño dice cada tele, porque a 4K no lo he medido.
- Cuánto aguanta cada tele por Wi-Fi con vuestro router y vídeos de unos 7,8 Mbps.
- El nombre de la salida de sonido del HDMI0 (`alsa_output.platform-fef00700.hdmi…`). Lo he sacado de la dirección del HDMI0 en el núcleo de Raspberry Pi. Si no coincide, esa parte de la regla no hace nada y queda la de cualquier HDMI.
- Que `comprobar.sh` encuentre en la Pi cada cosa donde la busca (el decodificador, la tele, la temperatura). Si alguna línea no cuadra, lo arreglo.
