import { emitKeypressEvents } from 'node:readline';
import { readConfig, StartupError } from './config.js';
import { openAccountStore } from './account-store.js';
import { hashPassword } from './passwords.js';
import { loginNameSchema, roleSchema } from '../shared/auth-contracts.js';
import { uuidSchema } from '../shared/review-contracts.js';
import { ApiFailure } from './http/errors.js';

function password(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new StartupError('TTY_REQUIRED', 'Password entry requires an interactive terminal.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt); emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
    const finish = (error?: Error) => {
      process.stdin.removeListener('keypress', input); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const input = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') { finish(new StartupError('CANCELLED', 'Account operation cancelled.')); return; }
      if (key.name === 'return' || key.name === 'enter') { finish(); return; }
      if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (text && !key.ctrl && [...text].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)) value += text;
    };
    process.stdin.on('keypress', input);
  });
}

async function main() {
  const [operation, rawLogin, ...args] = process.argv.slice(2);
  if (!operation || operation === 'help' || operation === '--help') {
    process.stdout.write('Account commands (uses DATA_DIR):\n  init <login> <display-name> [--user-id <historical-uuid>]\n  create <login> <display-name> [--user-id <historical-uuid>]\n  reset <login>\n  disable <login>\n  enable <login>\n  role <login> <member|admin>\n  list\nPasswords are entered privately; any password, including empty, is accepted. Stop your own server before initial migration.\n'); return;
  }
  if (!['init', 'create', 'reset', 'disable', 'enable', 'role', 'list'].includes(operation)) throw new StartupError('INVALID_COMMAND', 'Unknown account command. Run account help.');
  const loginName = operation === 'list' ? '' : loginNameSchema.parse(rawLogin);
  const store = openAccountStore(readConfig().dataDir, operation === 'init');
  try {
    if (operation === 'list') {
      if (rawLogin || args.length) throw new StartupError('INVALID_ARGUMENTS', 'Run account help.');
      process.stdout.write(JSON.stringify(store.db.prepare('SELECT a.login_name AS loginName,u.id AS userId,u.username,a.role,a.enabled FROM user_auth a JOIN users u ON u.id=a.user_id ORDER BY a.login_name').all()) + '\n'); return;
    }
    if (operation === 'init' || operation === 'create') {
      if (!args[0] || (args.length !== 1 && !(args.length === 3 && args[1] === '--user-id'))) throw new StartupError('INVALID_ARGUMENTS', 'Expected display name and optional --user-id UUID.');
      const hasAdmin = (store.db.prepare("SELECT count(*) AS n FROM user_auth WHERE role='admin' AND enabled=1").get() as { n: number }).n > 0;
      if (operation === 'init' && hasAdmin) throw new StartupError('ALREADY_INITIALIZED', 'An administrator already exists. Use create or role.');
      if (operation === 'create' && !hasAdmin) throw new StartupError('AUTH_INITIALIZATION_REQUIRED', 'Initialize an administrator first.');
      const first = await password('Password: '); const confirmation = await password('Confirm password: ');
      if (first !== confirmation) throw new StartupError('PASSWORD_MISMATCH', 'Passwords do not match.');
      const userId = args[2] ? uuidSchema.parse(args[2]) : undefined;
      store.accounts.create({ loginName, username: args[0], passwordHash: await hashPassword(first), role: operation === 'init' ? 'admin' : 'member', userId });
    } else {
      if ((operation === 'role' && args.length !== 1) || (operation !== 'role' && args.length)) throw new StartupError('INVALID_ARGUMENTS', 'Run account help.');
      if (operation === 'reset') {
        const first = await password('New password: '); const confirmation = await password('Confirm password: ');
        if (first !== confirmation) throw new StartupError('PASSWORD_MISMATCH', 'Passwords do not match.');
        store.accounts.change(loginName, { passwordHash: await hashPassword(first) });
      } else if (operation === 'role') store.accounts.change(loginName, { role: roleSchema.parse(args[0]) });
      else store.accounts.change(loginName, { enabled: operation === 'enable' });
    }
    process.stdout.write('Account updated. Existing sessions for changed accounts were revoked.\n');
  } finally { store.close(); }
}
main().catch((error: unknown) => {
  const code = error instanceof ApiFailure || error instanceof StartupError ? error.code : 'ACCOUNT_OPERATION_FAILED';
  process.stderr.write(code + ': Account operation failed. Check arguments, password rules, and DATA_DIR.\n'); process.exitCode = 1;
});
