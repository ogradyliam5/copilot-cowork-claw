#!/usr/bin/env node
// Generates a cryptographically-random API key suitable for API_KEY.
//
// Uses Node's crypto.randomBytes (CSPRNG), base64url-encoded, matching
// scripts/new-apikey.ps1. Invoked via `npm run new-apikey`.

import { randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('base64url');
console.log(key);
