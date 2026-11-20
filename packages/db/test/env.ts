// Load local secrets for the db suite; missing files are fine in CI-like runs.
for (const file of [".env", ".env.db"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // ignore
  }
}
