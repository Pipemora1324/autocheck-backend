import pg from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// Las columnas DATE se devuelven como 'YYYY-MM-DD' para no desplazarlas con la zona horaria del servidor.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// SSL obligatorio con verificación del certificado (Neon lo exige); solo se omite para un Postgres local.
// sslmode/channel_binding se quitan de la URL para que esta configuración sea la única fuente de verdad.
export function connectionOptions(databaseUrl: string): pg.PoolConfig {
  const url = new URL(databaseUrl);
  if (LOCAL_HOSTS.has(url.hostname)) return { connectionString: databaseUrl, ssl: false };

  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    enableChannelBinding: true
  };
}

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ ...connectionOptions(databaseUrl), max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (error) => {
    console.error('Error inesperado en la conexión a Postgres:', error.message);
  });
  return pool;
}
