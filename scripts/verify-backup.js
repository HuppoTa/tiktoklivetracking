import { readFile } from "node:fs/promises"; import { resolve } from "node:path";
const source=process.argv[2]; if(!source)throw new Error("Usage: node scripts/verify-backup.js <backup>"); const d=JSON.parse(await readFile(resolve(source),"utf8"));
console.log(JSON.stringify({valid:true,schemaVersion:d.schemaVersion??null,sessionCount:(d.sessions||[d.session].filter(Boolean)).length,commentCount:(d.comments||[]).length,threadCount:(d.questionThreads||[]).length}));
