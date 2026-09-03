import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const duplicateCount=values=>values.length-new Set(values).size;
export function auditMetadata(data){
  const sessions=data.sessions||[],comments=data.comments||[],threads=data.questionThreads||[],gifts=data.gifts||[],attention=data.giftAttention||[];
  const sessionIds=new Set(sessions.map(x=>x.id)),commentIds=new Set(comments.map(x=>`${x.sessionId}:${x.id}`)),threadById=new Map(threads.map(x=>[x.id,x]));
  const refs=threads.flatMap(q=>(q.commentIds||[]).map(id=>`${q.sessionId}:${id}`)),dates=[];
  for(const x of [...sessions,...comments,...threads,...gifts,...attention])for(const key of ["timestamp","receivedAt","eventTimestamp","createdAt","lastAskedAt","answeredAt","startedAt","connectedAt","endedAt","lastGiftAt","updatedAt"])if(x[key]!=null)dates.push(new Date(x[key]).getTime());
  const report={schemaVersion:data.schemaVersion,sessionCount:sessions.length,commentCount:comments.length,threadCount:threads.length,giftCount:gifts.length,giftAttentionCount:attention.length,occurrenceCount:refs.length,answeredCount:threads.filter(q=>q.answered).length,unansweredCount:threads.filter(q=>!q.answered&&!q.deleted&&!q.archived).length,
    orphanCount:comments.filter(c=>!sessionIds.has(c.sessionId)).length+threads.filter(q=>!sessionIds.has(q.sessionId)).length+refs.filter(id=>!commentIds.has(id)).length,
    duplicateIdCount:duplicateCount(comments.map(c=>`${c.sessionId}:${c.id}`))+duplicateCount(threads.map(q=>q.id)),duplicateQueueNumberCount:duplicateCount(threads.map(q=>`${q.sessionId}:${q.queueNumber}`)),duplicateGiftEventCount:duplicateCount(gifts.map(g=>`${g.sessionId}:${g.id}`)),duplicateAttentionCount:duplicateCount(attention.map(a=>`${a.sessionId}:${a.userId}`)),
    missingSessionIdCount:[...comments,...threads,...gifts,...attention].filter(x=>!x.sessionId).length,missingUserIdCount:[...comments,...threads,...gifts,...attention].filter(x=>!x.userId).length,invalidDateCount:dates.filter(x=>!Number.isFinite(x)).length,epoch1970Count:dates.filter(x=>x===0).length,
    orphanGiftSessionCount:gifts.filter(g=>!sessionIds.has(g.sessionId)).length,orphanAttentionSessionCount:attention.filter(a=>!sessionIds.has(a.sessionId)).length,
    invalidGiftLinkCount:attention.filter(a=>{if(!a.linkedQuestionId)return false;const q=threadById.get(a.linkedQuestionId);return!q||q.sessionId!==a.sessionId||q.userId!==a.userId}).length,
    invalidGiftValueCount:gifts.filter(g=>!g.id||!g.sessionId||!g.userId||!g.giftId||!Number.isSafeInteger(Number(g.repeatCount))||Number(g.repeatCount)<1||(g.totalDiamonds!==null&&(!Number.isFinite(Number(g.totalDiamonds))||Number(g.totalDiamonds)<0))).length,
    sessionTotalsMismatchCount:sessions.filter(s=>s.commentCount!==comments.filter(c=>c.sessionId===s.id).length||s.questionCount!==threads.filter(q=>q.sessionId===s.id&&!q.deleted).length).length,
    nextQueueNumberInconsistencyCount:sessions.filter(s=>Number(s.nextQueueNumber)<=Math.max(0,...threads.filter(q=>q.sessionId===s.id).map(q=>Number(q.queueNumber)||0))).length};
  report.ok=Object.entries(report).filter(([key])=>/(orphan|duplicate|missing|invalid|epoch|mismatch|inconsistency)/i.test(key)).every(([,value])=>value===0);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const path=process.argv[2]||"data/store.json",data=JSON.parse(await readFile(path,"utf8")),report={...auditMetadata(data),storeBytes:(await stat(path)).size};console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=2}
