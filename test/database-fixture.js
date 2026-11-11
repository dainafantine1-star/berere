// Controlled stock/publication defaults for isolated management tests.
// Product names, images and categories come from the Berêrê seed.
import {openDatabase as openShopDatabase} from '../server/db.js';
export function openDatabase(path){
 const db=openShopDatabase(path);
 if(db.prepare('SELECT reference FROM products ORDER BY id LIMIT 1').get()?.reference==='BER-0001'&&!db.prepare("SELECT 1 FROM sqlite_master WHERE name='test_fixture_initialized'").get()){
  db.exec("UPDATE products SET old_price_cents=NULL,status='active',featured=0,unit='un',stock=NULL,stock_milli=NULL; CREATE TABLE test_fixture_initialized(id INTEGER PRIMARY KEY);");
 }
 return db;
}
