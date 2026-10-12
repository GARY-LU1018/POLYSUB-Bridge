import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { DurableCompletionOutbox, readSessionCorrelation } from "./completionOutbox.js";
import { BlueWakeHostCapabilitiesState } from "./blueWakeHostCapabilities.js";

export const BLUE_WAKE_RESOURCE_URI = "ui://blue-wake/live-test-ab.html";
export const BLUE_WAKE_RENDER_RESOURCE_URI = "ui://blue-wake/render.html";
export const BLUE_WAKE_NEXT_TOOL = "blue_wake_next";
export const BLUE_WAKE_RENDER_TOOL = "blue_wake_render";
export const BLUE_WAKE_HOST_CAPABILITIES_TOOL = "blue_wake_host_capabilities";
const BLUE_WAKE_HOST_CAPABILITIES_CAPTURE_TOOL = "blue_wake_host_capabilities_capture";
const BLUE_WAKE_ACK_TOOL = "codex_completion_ack";
const BLUE_WAKE_VISIBLE_COMPLETION_MESSAGE = "工作已完成，請檢閱回報。";
const BLUE_WAKE_RESOURCE_MIME = "text/html;profile=mcp-app";

type BlueWakeEvent = { seq: number; payload: string; receivedAt: string };

export function createBlueWakeCompletionPayload(taskId: string, operation: string): string {
  return JSON.stringify({
    task_id: taskId,
    operation,
    completed: true,
    continuation: { tool: "codex_job_status", arguments: { taskId } }
  });
}

export class BlueWakeLiveTestState {
  readonly hostCapabilities = new BlueWakeHostCapabilitiesState();

  constructor(private readonly completionOutbox: DurableCompletionOutbox) {}

  emit(payload: string, durableSeq: number): BlueWakeEvent {
    if (!parseCodexCompletionPayload(payload)) throw new Error("Unexpected Blue-Wake payload.");
    if (!Number.isInteger(durableSeq) || durableSeq <= 0) {
      throw new Error("Blue-Wake completion requires a durable outbox sequence.");
    }
    return { seq: durableSeq, payload, receivedAt: new Date().toISOString() };
  }

  next(after: number, taskId: string, sessionCorrelation?: string): BlueWakeEvent | null {
    const durable = this.completionOutbox.read({ after, taskId, sessionCorrelation });
    return durable ? { seq: durable.seq, payload: durable.payload, receivedAt: new Date(durable.createdAt).toISOString() } : null;
  }
}

function parseCodexCompletionPayload(payload: string): { taskId: string } | null {
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (typeof value.task_id !== "string" || typeof value.operation !== "string" || value.completed !== true) return null;
    return { taskId: value.task_id };
  } catch {
    return null;
  }
}

export function registerBlueWakeUi(server: McpServer, state: BlueWakeLiveTestState): void {
  server.registerResource(
    "Blue-Wake A handoff widget",
    BLUE_WAKE_RESOURCE_URI,
    { mimeType: BLUE_WAKE_RESOURCE_MIME, description: "A-side Blue-Wake handoff widget for one caller-provided task." },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: BLUE_WAKE_RESOURCE_MIME, text: blueWakeHandoffWidgetHtml() }] })
  );

  server.registerResource(
    "Blue-Wake B completion receiver widget",
    BLUE_WAKE_RENDER_RESOURCE_URI,
    { mimeType: BLUE_WAKE_RESOURCE_MIME, description: "Read-only B-side Blue-Wake completion receiver for one task." },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: BLUE_WAKE_RESOURCE_MIME, text: blueWakeReceiverWidgetHtml() }] })
  );

  server.registerTool(
    BLUE_WAKE_NEXT_TOOL,
    {
      title: "Read pending Blue-Wake event",
      description: "Read-only retrieval of a pending Blue-Wake completion event for the caller-provided taskId. It does not create, execute, or acknowledge an event.",
      inputSchema: {
        after: z.number().int().nonnegative().optional().describe("Return only an event with a higher sequence number."),
        taskId: z.string().trim().min(1).max(128).describe("Return only the completion event for this canonical taskId.")
      },
      outputSchema: {
        event: z.union([z.object({ seq: z.number().int().positive(), payload: z.string(), receivedAt: z.string() }), z.null()]),
        after: z.number().int().nonnegative(),
        nextAfter: z.number().int().nonnegative()
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (args, extra) => {
      const after = args.after ?? 0;
      const event = state.next(after, args.taskId, readSessionCorrelation(extra._meta));
      const result = { event, after, nextAfter: event?.seq ?? after };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );

  server.registerTool(
    BLUE_WAKE_RENDER_TOOL,
    {
      title: "Render Blue-Wake completion receiver",
      description:
        "Read-only render mount for the B turn. Call this with the exact taskId from the Blue-Wake handoff marker. It does not start work, read job status, or acknowledge a completion; the mounted receiver reuses the existing blue_wake_next delivery path.",
      _meta: { ui: { resourceUri: BLUE_WAKE_RENDER_RESOURCE_URI } },
      inputSchema: {
        taskId: z.string().trim().min(1).max(128).describe("The exact canonical taskId from the A-to-B handoff marker.")
      },
      outputSchema: {
        taskId: z.string(),
        marker: z.literal("BLUE_WAKE_B_RECEIVER"),
        mode: z.literal("receiver")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (args) => {
      const result = { taskId: args.taskId, marker: "BLUE_WAKE_B_RECEIVER" as const, mode: "receiver" as const };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );

  server.registerTool(
    BLUE_WAKE_HOST_CAPABILITIES_TOOL,
    {
      title: "Read Blue-Wake host capabilities",
      description: "Read the bounded in-memory host capability declaration observed by the Blue-Wake widget. No raw host response or user data is retained.",
      inputSchema: {},
      outputSchema: {
        observation: z.enum(["not_observed", "observed"]),
        message: z.object({ text: z.enum(["yes", "no", "unknown"]), structuredContent: z.enum(["yes", "no", "unknown"]) }),
        updateModelContext: z.object({ text: z.enum(["yes", "no", "unknown"]), structuredContent: z.enum(["yes", "no", "unknown"]) })
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      const result = state.hostCapabilities.read();
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );

  server.registerTool(
    BLUE_WAKE_HOST_CAPABILITIES_CAPTURE_TOOL,
    {
      title: "Capture Blue-Wake host capability declarations",
      description: "Internal widget report path. Accepts only the four allowlisted ui/initialize declaration booleans and keeps them in bounded process memory for blue_wake_host_capabilities.",
      inputSchema: {
        hostCapabilities: z.object({
          message: z.object({ text: z.boolean().optional(), structuredContent: z.boolean().optional() }).optional(),
          updateModelContext: z.object({ text: z.boolean().optional(), structuredContent: z.boolean().optional() }).optional()
        }).describe("Bounded ui/initialize declaration report.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (args) => {
      const result = state.hostCapabilities.capture(args.hostCapabilities);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );
}

function widgetShell(body: string, script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>POLYSUB Bridge</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:12px;color:#202124}body>h3,#state{display:none}#status-card,#completion-card{box-sizing:border-box;max-width:320px;padding:14px 16px;border-radius:12px}#status-card{border:1px solid #d8dee8;background:#fff;box-shadow:0 2px 8px rgba(32,33,36,.08)}#status-card strong,#completion-card strong{display:block;font-size:15px;font-weight:650}#status-card p,#completion-card p{margin:6px 0 10px}#status-card p,#status-card .status{color:#5f6368}#completion-card{border:1px solid #34a853;background:#e6f4ea;color:#137333;box-shadow:0 2px 8px rgba(52,168,83,.18)}#status-card[hidden],#completion-card[hidden]{display:none}</style></head><body>${body}<h3>Blue-Wake callback A/B widget</h3><div id="state"></div><script>${script}</script></body></html>`;
}

function blueWakeHandoffWidgetHtml(): string {
  const captureTool = JSON.stringify(BLUE_WAKE_HOST_CAPABILITIES_CAPTURE_TOOL);
  return widgetShell(
    '<section id="status-card" aria-label="POLYSUB Bridge status"><strong>POLYSUB Bridge 已啟用</strong><p>Callback 已啟用；長任務完成後會自動送回目前的 ChatGPT 對話，無需等待或操作。</p><div class="status">● Callback 已啟用</div></section><section id="completion-card" hidden aria-live="polite" aria-label="Codex completion"><strong>工作已完成</strong><p>工作已完成，請檢閱回報。</p></section>',
    `(()=>{const captureTool=${captureTool},RPC_TIMEOUT_MS=2000;let rpcId=0,stopped=false,handoffSent=false;const pending=new Map(),state=document.getElementById("state"),lines=[];const isRecord=value=>value!==null&&typeof value==="object";const safeJson=value=>{try{const json=JSON.stringify(value);return json===undefined?String(value):json;}catch{return String(value);}};const safeText=value=>String(value===undefined||value===null?"":value).replace(/[\\r\\n]+/g," ").slice(0,256);const write=line=>{lines.push(line);state.textContent=lines.join("\\n");console.info("[Blue-Wake]",line);};const rpcError=error=>{const value=isRecord(error)?error:{};const code=value.code===undefined?"UNKNOWN":value.code;const message=value.message===undefined?String(error):value.message;return "code="+safeJson(code)+" message="+safeText(message);};const readTaskId=()=>{const openai=typeof window!=="undefined"?window.openai:null;const output=openai&&isRecord(openai.toolOutput)?openai.toolOutput:null;const structured=output&&isRecord(output.structuredContent)?output.structuredContent:null;const value=output&&typeof output.taskId==="string"?output.taskId:structured&&typeof structured.taskId==="string"?structured.taskId:null;return value&&value.trim()?value.trim():null;};const notify=(method,params)=>window.parent.postMessage({jsonrpc:"2.0",method,params},"*");const request=(method,params)=>new Promise((resolve,reject)=>{const id=++rpcId;let settled=false;const timeoutId=window.setTimeout(()=>{if(settled)return;settled=true;pending.delete(id);reject({code:"RPC_TIMEOUT",message:"Bounded host RPC watchdog expired for "+method});},RPC_TIMEOUT_MS);const finish=(callback,value)=>{if(settled)return;settled=true;window.clearTimeout(timeoutId);pending.delete(id);callback(value);};pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});try{window.parent.postMessage({jsonrpc:"2.0",id,method,params},"*");}catch(error){finish(reject,{code:"POSTMESSAGE_FAILED",message:String(error),definitelyNotSent:true});}});const stop=()=>{stopped=true;};const onMessage=event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=="2.0")return;if(message.method==="ui/resource-teardown"&&message.id!==undefined){stop();for(const [id,call] of pending){pending.delete(id);call.reject({code:"UI_RESOURCE_TEARDOWN",message:"Host tore down the widget before the RPC completed"});}write("TEARDOWN_ACK");window.parent.postMessage({jsonrpc:"2.0",id:message.id,result:{}},"*");window.removeEventListener("message",onMessage);return;}if(message.id!==undefined&&pending.has(message.id)){const call=pending.get(message.id);pending.delete(message.id);if(message.error!==undefined)call.reject(message.error);else call.resolve(message.result);}};window.addEventListener("message",onMessage,{passive:true});const bridgeReady=(async()=>{const init=await request("ui/initialize",{appInfo:{name:"blue-wake-handoff",version:"0.4.0"},appCapabilities:{},protocolVersion:"2026-01-26"});const hostCapabilities=init&&isRecord(init.hostCapabilities)?init.hostCapabilities:{};const facts=group=>{const value=isRecord(group)?group:{};return {text:Object.prototype.hasOwnProperty.call(value,"text"),structuredContent:Object.prototype.hasOwnProperty.call(value,"structuredContent")};};write("ui/initialize SUCCESS(result=RECEIVED)");notify("ui/notifications/initialized",{});try{await request("tools/call",{name:captureTool,arguments:{hostCapabilities:{message:facts(hostCapabilities.message),updateModelContext:facts(hostCapabilities.updateModelContext)}}});}catch(error){write("HOST_CAPABILITIES_CAPTURE ERROR("+rpcError(error)+")");}})();bridgeReady.then(async()=>{if(stopped||handoffSent)return;const taskId=readTaskId();if(!taskId){write("TASK_ID_REQUIRED");return;}handoffSent=true;const marker="POLYSUB Blue-Wake continuation: task_id="+safeJson(taskId)+" marker=BLUE_WAKE_B_RECEIVER. Call blue_wake_render with this exact task_id to mount the completion receiver.";write("A ui/message REQUEST_SENT(task_id="+safeJson(taskId)+", marker=BLUE_WAKE_B_RECEIVER)");try{const result=await request("ui/message",{role:"user",content:[{type:"text",text:marker}]});if(!isRecord(result)||result.isError===true||Object.prototype.hasOwnProperty.call(result,"error")){write("A ui/message NOT_ACCEPTED");return;}write("A ui/message SUCCESS(result=RECEIVED, task_id="+safeJson(taskId)+")");}catch(error){write("A ui/message ERROR("+rpcError(error)+")");}}).catch(error=>{if(!stopped)write("ui/initialize ERROR("+rpcError(error)+")");});})()`
  );
}

function blueWakeReceiverWidgetHtml(): string {
  const nextTool = JSON.stringify(BLUE_WAKE_NEXT_TOOL);
  const captureTool = JSON.stringify(BLUE_WAKE_HOST_CAPABILITIES_CAPTURE_TOOL);
  const ackTool = JSON.stringify(BLUE_WAKE_ACK_TOOL);
  const visibleMessage = JSON.stringify(BLUE_WAKE_VISIBLE_COMPLETION_MESSAGE);
  return widgetShell(
    '<section id="status-card" aria-label="POLYSUB Bridge status"><strong>POLYSUB Bridge 已啟用</strong><p>完成的工作會自動送回目前的 ChatGPT 對話。</p><div class="status">● B completion receiver</div></section><section id="completion-card" hidden aria-live="polite" aria-label="Codex completion"><strong>工作已完成</strong><p>工作已完成，請檢閱回報。</p></section>',
    `(()=>{const nextTool=${nextTool},captureTool=${captureTool},ackTool=${ackTool},visibleMessage=${visibleMessage};const RPC_TIMEOUT_MS=2000,RPC_TIMEOUT_RETRIES=2;let rpcId=0,after=0,expectedTaskId=null,stopped=false,pollTimer=null;const pending=new Map(),state=document.getElementById("state"),completionCard=document.getElementById("completion-card"),lines=[];const safeJson=value=>{try{const json=JSON.stringify(value);return json===undefined?String(value):json;}catch{return String(value);}};const safeText=value=>String(value===undefined||value===null?"":value).replace(/[\\r\\n]+/g," ").slice(0,256);const write=line=>{lines.push(line);state.textContent=lines.join("\\n");console.info("[Blue-Wake]",line);};const isRecord=value=>value!==null&&typeof value==="object";const stringValue=value=>typeof value==="string"&&value.length>0?value:null;const rpcError=error=>{const value=isRecord(error)?error:{};const code=value.code===undefined?"UNKNOWN":value.code;const message=value.message===undefined?String(error):value.message;return "code="+safeJson(code)+" message="+safeText(message);};const readTaskId=()=>{const openai=typeof window!=="undefined"?window.openai:null;const output=openai&&isRecord(openai.toolOutput)?openai.toolOutput:null;const structured=output&&isRecord(output.structuredContent)?output.structuredContent:null;return stringValue(output&&output.taskId)||stringValue(structured&&structured.taskId)||null;};const accepted=result=>isRecord(result)&&result.isError!==true&&!Object.prototype.hasOwnProperty.call(result,"error");const notify=(method,params)=>window.parent.postMessage({jsonrpc:"2.0",method,params},"*");const request=(method,params,options={})=>{const retryable=options.retryable===true;const attempt=number=>new Promise((resolve,reject)=>{const id=++rpcId;let settled=false;const finish=(callback,value)=>{if(settled)return;settled=true;window.clearTimeout(timeoutId);pending.delete(id);callback(value);};const timeoutId=window.setTimeout(()=>{if(settled)return;settled=true;pending.delete(id);if(retryable&&number<RPC_TIMEOUT_RETRIES){write("RPC_TIMEOUT_RETRY(method="+method+", attempt="+(number+1)+")");attempt(number+1).then(resolve,reject);}else reject({code:"RPC_TIMEOUT",message:"Bounded host RPC watchdog expired for "+method});},RPC_TIMEOUT_MS);pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});try{window.parent.postMessage({jsonrpc:"2.0",id,method,params},"*");}catch(error){finish(reject,{code:"POSTMESSAGE_FAILED",message:String(error),definitelyNotSent:true});}});return attempt(0);};const stop=()=>{stopped=true;if(pollTimer!==null){window.clearTimeout(pollTimer);pollTimer=null;}};const onMessage=event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=="2.0")return;if(message.method==="ui/resource-teardown"&&message.id!==undefined){stop();for(const [id,call] of pending){pending.delete(id);call.reject({code:"UI_RESOURCE_TEARDOWN",message:"Host tore down the widget before the RPC completed"});}write("TEARDOWN_ACK");window.parent.postMessage({jsonrpc:"2.0",id:message.id,result:{}},"*");window.removeEventListener("message",onMessage);return;}if(message.id!==undefined&&pending.has(message.id)){const call=pending.get(message.id);pending.delete(message.id);if(message.error!==undefined)call.reject(message.error);else call.resolve(message.result);}};window.addEventListener("message",onMessage,{passive:true});const bridgeReady=(async()=>{const init=await request("ui/initialize",{appInfo:{name:"blue-wake-render",version:"0.4.0"},appCapabilities:{},protocolVersion:"2026-01-26"},{retryable:true});const capabilities=init&&isRecord(init.hostCapabilities)?init.hostCapabilities:{};const facts=group=>{const value=isRecord(group)?group:{};return {text:Object.prototype.hasOwnProperty.call(value,"text"),structuredContent:Object.prototype.hasOwnProperty.call(value,"structuredContent")};};write("ui/initialize SUCCESS(result=RECEIVED)");notify("ui/notifications/initialized",{});try{await request("tools/call",{name:captureTool,arguments:{hostCapabilities:{message:facts(capabilities.message),updateModelContext:facts(capabilities.updateModelContext)}}},{retryable:true});write("HOST_CAPABILITIES_CAPTURE SUCCESS");}catch(error){write("HOST_CAPABILITIES_CAPTURE ERROR("+rpcError(error)+")");}})();const callTool=async(name,args)=>{await bridgeReady;return request("tools/call",{name,arguments:args},{retryable:true});};const runContext=async(payload,seq,taskId)=>{write("B ui/update-model-context REQUEST_SENT(seq="+seq+", task_id="+safeJson(taskId)+")");try{const result=await request("ui/update-model-context",{content:[{type:"text",text:payload,annotations:{audience:["assistant"]}}]});if(!accepted(result)){write("B ui/update-model-context NOT_ACCEPTED");return false;}write("B ui/update-model-context SUCCESS(result=RECEIVED)");return true;}catch(error){write("B ui/update-model-context ERROR("+rpcError(error)+")");return false;}};const runMessage=async(seq,taskId)=>{write("B ui/message REQUEST_SENT(seq="+seq+", task_id="+safeJson(taskId)+")");try{const result=await request("ui/message",{role:"user",content:[{type:"text",text:visibleMessage}]});if(!accepted(result)){write("B ui/message NOT_ACCEPTED");return {accepted:false,definitelyNotSent:false};}if(completionCard)completionCard.hidden=false;write("B ui/message SUCCESS(result=RECEIVED)");return {accepted:true,definitelyNotSent:false};}catch(error){write("B ui/message ERROR("+rpcError(error)+")");return {accepted:false,definitelyNotSent:Boolean(error&&error.definitelyNotSent)};}};const runFallback=async(seq,taskId)=>{const openai=typeof window!=="undefined"?window.openai:undefined;const send=openai&&typeof openai.sendFollowUpMessage==="function"?openai.sendFollowUpMessage.bind(openai):null;if(!send){write("C window.openai.sendFollowUpMessage NOT_AVAILABLE");return false;}write("C window.openai.sendFollowUpMessage REQUEST_SENT(seq="+seq+", task_id="+safeJson(taskId)+")");try{await Promise.race([Promise.resolve(send({prompt:visibleMessage})),new Promise((_,reject)=>window.setTimeout(()=>reject({code:"RPC_TIMEOUT",message:"Bounded host watchdog expired for sendFollowUpMessage"}),RPC_TIMEOUT_MS))]);if(completionCard)completionCard.hidden=false;write("C window.openai.sendFollowUpMessage SUCCESS(result=RECEIVED)");return true;}catch(error){write("C window.openai.sendFollowUpMessage ERROR("+rpcError(error)+")");return false;}};const schedule=()=>{if(stopped||pollTimer!==null)return;pollTimer=window.setTimeout(()=>{pollTimer=null;void poll();},1000);};const poll=async()=>{if(stopped||!expectedTaskId)return;try{const taskId=expectedTaskId;const result=await callTool(nextTool,{after,taskId});const event=result&&result.structuredContent&&result.structuredContent.event;if(event&&Number.isInteger(event.seq)&&event.seq>after){let eventTaskId=null;try{const payload=JSON.parse(event.payload);eventTaskId=stringValue(payload&&payload.task_id);}catch{}if(eventTaskId!==taskId){write("CORRELATION_MISMATCH(expected_task_id="+safeJson(taskId)+", received_task_id="+safeJson(eventTaskId)+")");schedule();return;}write("COMPLETION_RECEIVED(seq="+event.seq+", task_id="+safeJson(taskId)+")");const context=await runContext(event.payload,event.seq,taskId);if(!context){write("COMPLETION_DELIVERY_PENDING(task_id="+safeJson(taskId)+")");schedule();return;}const visible=await runMessage(event.seq,taskId);let delivered=visible.accepted;if(!delivered&&visible.definitelyNotSent)delivered=await runFallback(event.seq,taskId);if(!delivered){write("COMPLETION_DELIVERY_PENDING(task_id="+safeJson(taskId)+")");schedule();return;}try{await callTool(ackTool,{taskId});after=event.seq;write("COMPLETION_ACK SUCCESS(task_id="+safeJson(taskId)+")");}catch(error){write("COMPLETION_ACK ERROR("+rpcError(error)+")");}schedule();return;}}catch(error){if(!stopped)write("MCP Apps bridge ERROR("+rpcError(error)+")");}schedule();};bridgeReady.then(async()=>{const taskId=readTaskId();if(!taskId){write("TASK_ID_REQUIRED");return;}expectedTaskId=taskId;write("TASK_CORRELATION(taskId="+safeJson(taskId)+")");await poll();}).catch(error=>{if(!stopped)write("MCP Apps initialization ERROR("+rpcError(error)+")");});})()`
  );
}
