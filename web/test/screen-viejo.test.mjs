// La copia de screen.js para los Chrome viejos (public/js/screen-viejo.js) va
// hecha en git. Si se cambia screen.js y no se rehace, la tablet se quedaría
// con la página de antes sin que nadie lo note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESTINO, screenViejo } from '../scripts/screen-viejo.mjs';

test('screen-viejo.js está al día con screen.js', () => {
  assert.equal(readFileSync(DESTINO, 'utf8'), screenViejo(), 'screen.js ha cambiado y screen-viejo.js no. Pasa npm run screen-viejo');
});
