export function audit(db, actor, action, entity, id, before, after) {
  db.prepare('INSERT INTO audit_log(actor_id,actor_email,action,entity,entity_id,before_json,after_json) VALUES(?,?,?,?,?,?,?)')
    .run(actor.id,actor.email,action,entity,String(id),before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after));
}
