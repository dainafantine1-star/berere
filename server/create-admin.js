import { openDatabase } from './db.js';
import { createAdmin } from './auth.js';
const db = openDatabase();
try {
  createAdmin(db, { email:process.env.ADMIN_EMAIL, password:process.env.ADMIN_PASSWORD });
  console.log('Administrador criado. Remova ADMIN_PASSWORD do ambiente após o cadastro.');
} catch (error) { console.error(error.status ? error.message : 'Não foi possível criar o administrador. Verifique os dados e se o e-mail já existe.'); process.exitCode=1; }
finally { db.close(); }
