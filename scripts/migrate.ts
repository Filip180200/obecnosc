import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);
db.close();
console.log("Migracje SQLite zakończone poprawnie.");
