// Node 20.12+ can load .env without an extra dependency.
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
