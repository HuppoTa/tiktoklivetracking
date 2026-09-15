import { neon } from "@neondatabase/serverless";
import { buildStore, JsonStorage, SCHEMA_VERSION } from "./storage.js";

const STATE_ID = 1;
const STORAGE_MODE = "normalized-v1";
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS app_state (id smallint PRIMARY KEY CHECK (id = 1),schema_version integer NOT NULL,state jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`;
const CREATE_BACKUPS_TABLE = `CREATE TABLE IF NOT EXISTS session_backups (id bigserial PRIMARY KEY,session_id text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`;
const CREATE_RECORDS_TABLE = `CREATE TABLE IF NOT EXISTS app_records (kind text NOT NULL,record_id text NOT NULL,session_id text,payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY (kind, record_id))`;
const CREATE_RECORDS_SESSION_INDEX = `CREATE INDEX IF NOT EXISTS app_records_session_idx ON app_records (session_id, kind)`;

const parseJson=value=>typeof value==="string"?JSON.parse(value):value;
const compositeId=(sessionId,id)=>JSON.stringify([String(sessionId||""),String(id||"")]);
const recordKey=record=>`${record.kind}\u0000${record.record_id}`;
function recordFingerprint(record){
  if(record.kind==="comment"){
    const item=record.payload;
    return JSON.stringify([item.manuallyPromoted===true,item.manuallyPromotedAt||null,item.manuallyPromotedReason||null]);
  }
  if(["gift","welcome_user","joined_user","member_message","viewer_sample"].includes(record.kind))return record.record_id;
  return JSON.stringify(record.payload);
}
const compactState=store=>({schemaVersion:SCHEMA_VERSION,storageMode:STORAGE_MODE,stateRevision:Math.max(0,Number(store.stateRevision)||0),activeSessionId:store.activeSessionId||null,settings:store.settings,giftSettings:store.giftSettings});

function recordsFromStore(store){
  const records=[],add=(kind,recordId,sessionId,payload)=>records.push({kind,record_id:String(recordId),session_id:sessionId?String(sessionId):null,payload});
  for(const session of store.sessions||[]){
    const viewer=session.viewerAnalytics||{};
    add("session",session.id,session.id,{...session,welcomedUserIds:[],viewerAnalytics:{...viewer,joinedUserIds:[],memberMessageIds:[],viewerSamples:[]}});
    for(const userId of session.welcomedUserIds||[])add("welcome_user",compositeId(session.id,userId),session.id,{userId:String(userId)});
    for(const userId of viewer.joinedUserIds||[])add("joined_user",compositeId(session.id,userId),session.id,{userId:String(userId)});
    for(const messageId of viewer.memberMessageIds||[])add("member_message",compositeId(session.id,messageId),session.id,{messageId:String(messageId)});
    for(const sample of viewer.viewerSamples||[])add("viewer_sample",compositeId(session.id,sample.timestamp),session.id,sample);
  }
  for(const item of store.comments||[])add("comment",compositeId(item.sessionId,item.id),item.sessionId,item);
  for(const item of store.questionThreads||[])add("question_thread",compositeId(item.sessionId,item.id),item.sessionId,item);
  for(const item of store.gifts||[])add("gift",compositeId(item.sessionId,item.id),item.sessionId,item);
  for(const item of store.giftAttention||[])add("gift_attention",compositeId(item.sessionId,item.userId),item.sessionId,item);
  return [...new Map(records.map(record=>[recordKey(record),record])).values()];
}

function storeFromRecords(metadata,rows){
  const state={...metadata,sessions:[],comments:[],questionThreads:[],gifts:[],giftAttention:[]},extras=new Map();
  const extrasFor=id=>{if(!extras.has(id))extras.set(id,{welcomedUserIds:[],joinedUserIds:[],memberMessageIds:[],viewerSamples:[]});return extras.get(id);};
  for(const row of rows){
    const payload=parseJson(row.payload),sessionId=String(row.session_id||payload?.sessionId||"");
    if(row.kind==="session")state.sessions.push(payload);
    else if(row.kind==="comment")state.comments.push(payload);
    else if(row.kind==="question_thread")state.questionThreads.push(payload);
    else if(row.kind==="gift")state.gifts.push(payload);
    else if(row.kind==="gift_attention")state.giftAttention.push(payload);
    else if(row.kind==="welcome_user")extrasFor(sessionId).welcomedUserIds.push(String(payload.userId));
    else if(row.kind==="joined_user")extrasFor(sessionId).joinedUserIds.push(String(payload.userId));
    else if(row.kind==="member_message")extrasFor(sessionId).memberMessageIds.push(String(payload.messageId));
    else if(row.kind==="viewer_sample")extrasFor(sessionId).viewerSamples.push(payload);
  }
  for(const session of state.sessions){const extra=extrasFor(session.id);session.welcomedUserIds=extra.welcomedUserIds;session.viewerAnalytics={...(session.viewerAnalytics||{}),joinedUserIds:extra.joinedUserIds,memberMessageIds:extra.memberMessageIds,viewerSamples:extra.viewerSamples.sort((a,b)=>String(a.timestamp||"").localeCompare(String(b.timestamp||"")))};}
  state.comments.sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0)||String(a.receivedAt||"").localeCompare(String(b.receivedAt||"")));
  state.questionThreads.sort((a,b)=>Number(a.queueNumber||0)-Number(b.queueNumber||0)||String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
  state.sessions.sort((a,b)=>String(a.startedAt||"").localeCompare(String(b.startedAt||"")));
  state.gifts.sort((a,b)=>String(a.receivedAt||"").localeCompare(String(b.receivedAt||"")));
  return buildStore(state.comments,state);
}

export class NeonStorage{
  constructor({databaseUrl,sql}){
    if(!databaseUrl&&!sql)throw new Error("DATABASE_URL_REQUIRED");
    this.sql=sql||neon(databaseUrl);this.store=buildStore();this.persistedRecords=new Map();this.persistedCompact=null;this.queue=Promise.resolve();this.pendingTransactions=0;this.savePromise=null;this.saveRequested=false;
    this.health={lastSaveAt:null,lastSaveErrorAt:null,consecutiveSaveFailures:0,storageHealthy:true,loadHealthy:true,invariantErrors:[]};
    this.validator=new JsonStorage({storeFile:"/tmp/neon-storage-unused.json",legacyFile:"/tmp/neon-storage-unused-legacy.json"});
  }
  async initialize(){
    await this.execute(CREATE_TABLE);await this.execute(CREATE_BACKUPS_TABLE);await this.execute(CREATE_RECORDS_TABLE);await this.execute(CREATE_RECORDS_SESSION_INDEX);
    const stateRows=await this.sql`SELECT state FROM app_state WHERE id = ${STATE_ID} LIMIT 1`;
    const metadata=stateRows[0]?.state?parseJson(stateRows[0].state):null;
    const rows=await this.sql`SELECT kind, record_id, session_id, payload FROM app_records`;
    if(metadata?.storageMode===STORAGE_MODE){
      this.store=storeFromRecords(metadata,rows);this.setPersistedBaseline(this.store);
      const repairedThreads=new Map(this.store.questionThreads.map(thread=>[compositeId(thread.sessionId,thread.id),thread]));
      const queueRepairs=rows.filter(row=>row.kind==="question_thread"&&Number(parseJson(row.payload)?.queueNumber)!==Number(repairedThreads.get(row.record_id)?.queueNumber));
      if(queueRepairs.length){
        const affectedSessions=new Set(queueRepairs.map(row=>String(row.session_id)));
        for(const sessionId of affectedSessions){
          const originals=rows.filter(row=>row.session_id===sessionId&&(row.kind==="session"||queueRepairs.includes(row)));
          await this.sql`INSERT INTO session_backups (session_id,payload) VALUES (${sessionId},${JSON.stringify({schemaVersion:SCHEMA_VERSION,backupType:"queue-repair",exportedAt:new Date().toISOString(),records:originals.map(row=>({kind:row.kind,recordId:row.record_id,payload:parseJson(row.payload)}))})}::jsonb)`;
          for(const row of originals)this.persistedRecords.set(recordKey(row),recordFingerprint({...row,payload:parseJson(row.payload)}));
        }
        await this.persist(this.store);
      }
    }
    else{
      this.store=metadata?buildStore(metadata.comments||[],metadata):buildStore();
      // A previous migration can be followed by a rollback that rewrites the
      // legacy snapshot. Seed record keys so the next migration also removes
      // normalized rows that no longer exist in that authoritative snapshot.
      this.persistedRecords=new Map(rows.map(row=>[recordKey(row),recordFingerprint({...row,payload:parseJson(row.payload)})]));
      await this.persist(this.store);
    }
    this.health.loadHealthy=true;this.health.storageHealthy=true;return this.store;
  }
  execute(query){return this.sql.query?this.sql.query(query):this.sql(query);}
  load(){return this.initialize();}
  validate(candidate=this.store){this.validator.store=candidate;const result=this.validator.validate(candidate);this.health.invariantErrors=result.errors;return result;}
  setPersistedBaseline(candidate){this.persistedRecords=new Map(recordsFromStore(candidate).map(record=>[recordKey(record),recordFingerprint(record)]));this.persistedCompact=JSON.stringify(compactState(candidate));}
  async persist(candidate){
    const check=this.validate(candidate);if(!check.ok)throw new Error(`STORE_INVARIANT_FAILED:${check.errors.join(",")}`);
    const records=recordsFromStore(candidate),next=new Map(records.map(record=>[recordKey(record),recordFingerprint(record)]));
    const changed=records.filter(record=>this.persistedRecords.get(recordKey(record))!==next.get(recordKey(record))),deleted=[];
    for(const key of this.persistedRecords.keys())if(!next.has(key)){const split=key.indexOf("\u0000");deleted.push({kind:key.slice(0,split),record_id:key.slice(split+1)});}
    const compactJson=JSON.stringify(compactState(candidate));
    if(!changed.length&&!deleted.length&&compactJson===this.persistedCompact){this.health.lastSaveAt=new Date().toISOString();return;}
    try{
      await this.sql`
        WITH incoming AS (
          SELECT kind, record_id, session_id, payload FROM jsonb_to_recordset(${JSON.stringify(changed)}::jsonb)
          AS item(kind text, record_id text, session_id text, payload jsonb)
        ), upserted AS (
          INSERT INTO app_records (kind, record_id, session_id, payload, updated_at)
          SELECT kind, record_id, session_id, payload, now() FROM incoming
          ON CONFLICT (kind, record_id) DO UPDATE SET session_id=EXCLUDED.session_id,payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at RETURNING 1
        ), removed AS (
          DELETE FROM app_records target USING jsonb_to_recordset(${JSON.stringify(deleted)}::jsonb) AS item(kind text, record_id text)
          WHERE target.kind=item.kind AND target.record_id=item.record_id RETURNING 1
        ), saved_state AS (
          INSERT INTO app_state (id,schema_version,state,updated_at) VALUES (${STATE_ID},${SCHEMA_VERSION},${compactJson}::jsonb,now())
          ON CONFLICT (id) DO UPDATE SET schema_version=EXCLUDED.schema_version,state=EXCLUDED.state,updated_at=EXCLUDED.updated_at RETURNING 1
        )
        SELECT (SELECT count(*) FROM upserted) AS upserted,(SELECT count(*) FROM removed) AS removed,(SELECT count(*) FROM saved_state) AS state_saved
      `;
      this.persistedRecords=next;this.persistedCompact=compactJson;this.health.lastSaveAt=new Date().toISOString();this.health.consecutiveSaveFailures=0;this.health.storageHealthy=true;
    }catch(error){this.health.lastSaveErrorAt=new Date().toISOString();this.health.consecutiveSaveFailures+=1;this.health.storageHealthy=false;throw error;}
  }
  enqueue(operation){const current=this.queue.then(operation,operation);this.queue=current.catch(()=>undefined);return current;}
  save(){this.saveRequested=true;if(this.savePromise)return this.savePromise;this.savePromise=(async()=>{while(this.saveRequested){this.saveRequested=false;const snapshot=structuredClone(this.store);await this.enqueue(()=>this.persist(snapshot));}})().finally(()=>{this.savePromise=null;if(this.saveRequested)void this.save();});return this.savePromise;}
  mutate(mutator){return this.enqueue(async()=>{this.pendingTransactions+=1;try{const draft=structuredClone(this.store),result=await mutator(draft);draft.stateRevision=Math.max(0,Number(draft.stateRevision)||0)+1;await this.persist(draft);for(const key of Object.keys(this.store))delete this.store[key];Object.assign(this.store,draft);return result;}finally{this.pendingTransactions-=1;}});}
  readiness(){const validation=this.validate();return{ready:this.health.loadHealthy&&this.health.storageHealthy&&validation.ok,...this.health,pendingTransactions:this.pendingTransactions};}
  async backupSession(sessionId){const session=this.store.sessions.find(item=>item.id===sessionId);if(!session)throw new Error("SESSION_NOT_FOUND");const payload={schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),session,comments:this.store.comments.filter(item=>item.sessionId===sessionId),questionThreads:this.store.questionThreads.filter(item=>item.sessionId===sessionId),gifts:this.store.gifts.filter(item=>item.sessionId===sessionId),giftAttention:this.store.giftAttention.filter(item=>item.sessionId===sessionId)};await this.sql`INSERT INTO session_backups (session_id,payload) VALUES (${sessionId},${JSON.stringify(payload)}::jsonb)`;return{sessionId,commentCount:payload.comments.length,questionCount:payload.questionThreads.length};}
}

export const NEON_SCHEMA=`${CREATE_TABLE};\n${CREATE_BACKUPS_TABLE};\n${CREATE_RECORDS_TABLE};\n${CREATE_RECORDS_SESSION_INDEX};`;
