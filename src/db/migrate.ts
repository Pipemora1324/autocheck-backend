import { fileURLToPath } from 'node:url';
import { errorMessage } from '../errors/httpError.js';
import { runner } from 'node-pg-migrate';
import { z } from 'zod';
import { connectionOptions } from './pool.js';

// Funciona igual desde src/db (tsx) y desde dist/db (build): ambos están a dos niveles de la raíz.
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export async function runMigrations(
  databaseUrl: string,
  direction: 'up' | 'down' = 'up',
  count?: number
): Promise<void> {
  await runner({
    databaseUrl: connectionOptions(databaseUrl),
    dir: MIGRATIONS_DIR,
    direction,
    count: count ?? (direction === 'up' ? Infinity : 1),
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    log: (message) => {
      console.log(message);
    }
  });
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
  if (!databaseUrl.success) {
    console.error('DATABASE_URL no está definida o no es una URL postgres:// válida. Revisa tu archivo .env.');
    process.exit(1);
  }
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  runMigrations(databaseUrl.data, direction)
    .then(() => {
      console.log(`Migraciones (${direction}) aplicadas.`);
    })
    .catch((error: unknown) => {
      console.error('Error al ejecutar migraciones:', errorMessage(error));
      process.exit(1);
    });
}
