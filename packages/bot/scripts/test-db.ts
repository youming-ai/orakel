import { testConnection } from "../src/db/index.ts";

const result = await testConnection();
console.log(result ? "✓ PostgreSQL connected successfully" : "✗ Failed to connect to PostgreSQL");
process.exit(result ? 0 : 1);
