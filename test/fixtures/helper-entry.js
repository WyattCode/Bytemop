'use strict';
// Stand-in for the elevated process in tests: runs the real helper code in a plain Node child.
// BYTEMOP_TEST_ENV points the helper's *logical* environment at a sandbox (SystemRoot, LOCALAPPDATA).
const path = require('path');
const { runHelperFromArgs } = require('../../helper');

const env = { ...process.env, ...JSON.parse(process.env.BYTEMOP_TEST_ENV || '{}') };
runHelperFromArgs(process.argv, { rulesDir: path.join(__dirname, '..', '..', 'rules'), env })
  .then((ok) => process.exit(ok ? 0 : 1));
