let tail=Promise.resolve();
// Backups must see a stable set of immutable media while SQLite takes its snapshot.
export function withMediaLock(fn){const operation=tail.then(fn);tail=operation.catch(()=>{});return operation;}
