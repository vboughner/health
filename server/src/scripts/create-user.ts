/**
 * Create a login.
 *
 *   npm run create-user -- van
 *
 * Prompts for the password twice with echo off. There is no signup page — accounts
 * are made here on purpose, so the public app has nothing to sign up against.
 *
 * On the VPS, pass the env file — PM2 supplies ENV_FILE to the server process and
 * nothing supplies it to a shell:
 *
 *   ENV_FILE=/home/griljor/health-data/.env npm run create-user -- van
 *
 * Without it DB_PATH falls back to <repo>/data/app.db, and the account lands in a
 * second database the server never opens. See the banner below.
 */
import fs from 'fs';
import readline from 'readline';
import { Writable } from 'stream';
import { config } from '../config';
import { openDatabase } from '../db';
import { createUser } from '../auth';

function prompt(question: string, hidden = false): Promise<string> {
  let muted = false;

  const mutableOutput = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableOutput,
    terminal: true,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: npm run create-user -- <username>');
    process.exit(1);
  }

  // Printed before the prompt, not after. On the first deploy this ran without
  // ENV_FILE, so DB_PATH fell back to <repo>/data/app.db: it created a whole second
  // database, migrated it, and reported success — and the account did not exist as
  // far as the running server was concerned. The path was in the closing line all
  // along, where it was read as confirmation rather than as a warning. A database
  // that does not exist yet is the loudest form of that mistake, so it says so.
  const fresh = !fs.existsSync(config.dbPath);
  console.log(
    `Database: ${config.dbPath}${fresh ? '  (does not exist yet — will be created)' : ''}`,
  );

  const db = openDatabase(config.dbPath);

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    console.error(`User "${username}" already exists.`);
    process.exit(1);
  }

  const password = await prompt('Password: ', true);
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const confirm = await prompt('Confirm password: ', true);
  if (password !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  const user = await createUser(db, username, password);
  db.close();

  console.log(`Created user "${user.username}" (id ${user.id}) in ${config.dbPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
