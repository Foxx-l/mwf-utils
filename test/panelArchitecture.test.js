/**
 * Guards the direction of the panel's dependencies.
 *
 * `/panel` used to be a command module that events/ and handlers/ imported as a
 * library, which meant loading the command pulled four interaction handlers into
 * the process and put the arrows in the wrong direction. These two assertions
 * are what stop it drifting back.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function jsFilesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFilesUnder(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('panel module boundaries', () => {
  test('the command exports only what the command loader needs', () => {
    const panel = require('../src/commands/admin/panel');
    // Anything else here means the command has become a library again.
    expect(Object.keys(panel).sort()).toEqual(['data', 'execute']);
  });

  test('nothing under events/ or handlers/ imports a command module', () => {
    const offenders = [];
    for (const dir of ['events', 'handlers']) {
      for (const file of jsFilesUnder(path.join(SRC, dir))) {
        const source = fs.readFileSync(file, 'utf8');
        if (/require\((['"])[^'"]*commands\//.test(source)) {
          offenders.push(path.relative(SRC, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
