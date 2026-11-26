'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { runPowerShell, cleanError } = require('../powershell');

function fakeSpawn({ out = '', err = '', code = 0, hang = false }) {
  return () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stdout.setEncoding = () => {};
    p.stderr = new EventEmitter();
    p.killed = false;
    p.kill = () => { p.killed = true; setImmediate(() => p.emit('close', null)); };
    if (!hang) setImmediate(() => { if (out) p.stdout.emit('data', out); if (err) p.stderr.emit('data', err); p.emit('close', code); });
    return p;
  };
}

test('CLIXML error output becomes a readable one-line message', () => {
  const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">Cannot find path &apos;C:\\x&apos; because it does not exist._x000D__x000A_</S><S S="Error">At line:1 char:5_x000D__x000A_</S></Objs>';
  assert.strictEqual(cleanError(clixml), "Cannot find path 'C:\\x' because it does not exist.");
  assert.strictEqual(cleanError('plain text'), 'plain text');
});

test('a failing script rejects with the cleaned message', async () => {
  await assert.rejects(runPowerShell('x', {}, { spawn: fakeSpawn({ err: '#< CLIXML\n<Objs><S S="Error">bad thing_x000D__x000A_</S></Objs>', code: 1 }) }), /bad thing/);
});

test('output is returned on success', async () => {
  assert.strictEqual(await runPowerShell('x', {}, { spawn: fakeSpawn({ out: ' hi \n' }) }), 'hi');
});

test('a hung PowerShell is killed after the timeout', async () => {
  await assert.rejects(runPowerShell('x', {}, { spawn: fakeSpawn({ hang: true }), timeoutMs: 30 }), /timed out/);
});
