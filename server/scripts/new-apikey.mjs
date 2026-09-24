#!/usr/bin/env node
// Generates a cryptographically-random API key suitable for API_KEY.
//
// Uses Node's crypto.randomBytes (CSPRNG), base64url-encoded. Invoked via
// `npm run new-apikey`. (claw.ps1 makes its own key, so you only need this
// when running the server by hand.)

import { randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('base64url');
console.log(key);
