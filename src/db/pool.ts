import pg from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// SSL obligatorio (Neon lo exige); solo se omite para un Postgres local de desarrollo o pruebas.
export function connectionOptions(databaseUrl: string): pg.PoolConfig {
  const { hostname } = new URL(databaseUrl);
  return {
    connectionString: databaseUrl,
    ssl: LOCAL_HOSTS.has(hostname) ? false : { rejectUnauthorized: true }
  };
}

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ ...connectionOptions(databaseUrl), max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (error) => {
    console.error('Error inesperado en la conexión a Postgres:', error.message);
  });
  return pool;
}
