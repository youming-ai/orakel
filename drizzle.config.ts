import type { Config } from "drizzle-kit";

export default {
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		host: process.env.PGHOST || "orakel-db-tyrahi",
		port: Number(process.env.PGPORT) || 5432,
		user: process.env.PGUSER || "postgres",
		password: process.env.PGPASSWORD || "",
		database: process.env.PGDATABASE || "orakel-db",
		ssl: process.env.PGSSL === "true",
	},
} satisfies Config;
