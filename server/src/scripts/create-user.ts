/**
 * Create a login.
 *
 *   npm run create-user -- van
 *
 * Prompts for the password twice with echo off. There is no signup page — accounts
 * are made here on purpose, so the public app has nothing to sign up against.
 */
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
