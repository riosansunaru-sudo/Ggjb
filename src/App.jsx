import { useState, useRef, useCallback, useEffect } from "react";

// ── JSZip ──
function useJSZip() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.JSZip) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);
  return ready;
}

// ── Priorities ──
const CORE_PRIORITY = {
  "System.json":1,"CommonEvents.json":2,"Items.json":3,"Skills.json":4,
  "Enemies.json":5,"Troops.json":6,"Actors.json":7,"Classes.json":8,
  "Armors.json":9,"Weapons.json":10,"States.json":11,"MapInfos.json":12,
};
function filePriority(name) {
  const b = name.split("/").pop();
  if (CORE_PRIORITY[b] !== undefined) return CORE_PRIORITY[b];
  if (/^Map\d+\.json$/.test(b)) return 100 + parseInt(b.replace(/\D/g,""));
  return 999;
}

// ── Text detection ──
function hasEnglish(text) {
  if (!text || typeof text !== "string") return false;
  const c = text.replace(/\\[a-zA-Z]\[[^\]]*\]/g,"").replace(/\\[a-zA-Z.\^|!<>{}]/g,"").replace(/<[^>]+>/g,"");
  return /[a-zA-Z]{3,}/.test(c);
}

// ── Extraction ──
function extractMapTexts(data) {
  const out = [];
  (data.events||[]).forEach((ev,ei) => {
    if (!ev) return;
    (ev.pages||[]).forEach((pg,pi) => {
      (pg.list||[]).forEach((cmd,ci) => {
        if (!cmd) return;
        const p = `events.${ei}.pages.${pi}.list.${ci}`;
        if (cmd.code===101 && cmd.parameters?.[4] && hasEnglish(cmd.parameters[4]))
          out.push({path:`${p}.parameters.4`, text:cmd.parameters[4]});
        if (cmd.code===401 && cmd.parameters?.[0] && hasEnglish(cmd.parameters[0]))
          out.push({path:`${p}.parameters.0`, text:cmd.parameters[0]});
        if (cmd.code===102 && Array.isArray(cmd.parameters?.[0]))
          cmd.parameters[0].forEach((opt,oi)=>{ if(hasEnglish(opt)) out.push({path:`${p}.parameters.0.${oi}`,text:opt}); });
        if (cmd.code===402 && cmd.parameters?.[1] && hasEnglish(cmd.parameters[1]))
          out.push({path:`${p}.parameters.1`, text:cmd.parameters[1]});
      });
    });
  });
  return out;
}

function extractDataTexts(data, filename) {
  const out = [];
  if (filename==="System.json") {
    const t = data.terms||{};
    ["commands","basic","params"].forEach(k=>(t[k]||[]).forEach((v,i)=>{ if(v&&hasEnglish(v)) out.push({path:`terms.${k}.${i}`,text:v}); }));
    Object.entries(t.messages||{}).forEach(([k,v])=>{ if(v&&hasEnglish(v)) out.push({path:`terms.messages.${k}`,text:v}); });
    if(data.gameTitle&&hasEnglish(data.gameTitle)) out.push({path:"gameTitle",text:data.gameTitle});
    return out;
  }
  if (filename==="CommonEvents.json") {
    (data||[]).forEach((ev,ei)=>{
      if(!ev) return;
      if(ev.name&&hasEnglish(ev.name)) out.push({path:`${ei}.name`,text:ev.name});
      (ev.list||[]).forEach((cmd,ci)=>{
        if(!cmd) return;
        const p=`${ei}.list.${ci}`;
        if(cmd.code===401&&cmd.parameters?.[0]&&hasEnglish(cmd.parameters[0])) out.push({path:`${p}.parameters.0`,text:cmd.parameters[0]});
        if(cmd.code===102&&Array.isArray(cmd.parameters?.[0])) cmd.parameters[0].forEach((opt,oi)=>{ if(hasEnglish(opt)) out.push({path:`${p}.parameters.0.${oi}`,text:opt}); });
        if(cmd.code===402&&cmd.parameters?.[1]&&hasEnglish(cmd.parameters[1])) out.push({path:`${p}.parameters.1`,text:cmd.parameters[1]});
      });
    });
    return out;
  }
  (Array.isArray(data)?data:[data]).forEach((item,i)=>{
    if(!item||typeof item!=="object") return;
    const prefix = Array.isArray(data)?`${i}`:"";
    ["name","description","note","nickname","profile","message1","message2","message3","message4"].forEach(field=>{
      if(item[field]&&hasEnglish(item[field])) out.push({path:prefix?`${prefix}.${field}`:field, text:item[field]});
    });
    (item.pages||[]).forEach((pg,pi)=>{
      (pg.list||[]).forEach((cmd,ci)=>{
        if(!cmd) return;
        const p=`${i}.pages.${pi}.list.${ci}`;
        if(cmd.code===401&&cmd.parameters?.[0]&&hasEnglish(cmd.parameters[0])) out.push({path:`${p}.parameters.0`,text:cmd.parameters[0]});
        if(cmd.code===102&&Array.isArray(cmd.parameters?.[0])) cmd.parameters[0].forEach((opt,oi)=>{ if(hasEnglish(opt)) out.push({path:`${p}.parameters.0.${oi}`,text:opt}); });
      });
    });
  });
  return out;
}

function extractTexts(data, filename) {
  const b = filename.split("/").pop();
  if (/^Map\d+\.json$/.test(b)) return extractMapTexts(data);
  return extractDataTexts(data, b);
}

// ── Apply translations ──
function setDeep(obj, pathStr, value) {
  const parts = pathStr.split(".");
  let cur = obj;
  for (let i=0;i<parts.length-1;i++) {
    const k = isNaN(parts[i])?parts[i]:Number(parts[i]);
    if (cur[k]==null) return;
    cur = cur[k];
  }
  const last = isNaN(parts[parts.length-1])?parts[parts.length-1]:Number(parts[parts.length-1]);
  cur[last] = value;
}

function applyTranslations(data, items, translations) {
  const clone = JSON.parse(JSON.stringify(data));
  items.forEach((item,i)=>{ if(translations[i]&&typeof translations[i]==="string") setDeep(clone, item.path, translations[i]); });
  return clone;
}

// ── Claude API ──
const SYSTEM_PROMPT = `أنت مترجم محترف من الإنجليزية إلى العربية متخصص في ألعاب RPG.

قواعد صارمة:
1. حافظ على رموز RPG Maker تماماً: \\n \\N[x] \\I[x] \\C[x] \\V[x] \\G \\$ \\. \\| \\! \\> \\< \\^ \\fb \\{ \\} \\B \\i والأرقام بداخل الأقواس
2. حافظ على %1 %2 %3 كما هي
3. أسماء الشخصيات: احتفظ بها كما هي (Hiroshi, Natsuki إلخ)  
4. ترجمة طبيعية ومحكية — ليست رسمية مجففة
5. محتوى حساس: ترجمه بلغة معتدلة ومناسبة
6. رد فقط بـ JSON array نظيف — بدون markdown أو شرح`;

async function translateBatch(texts, apiKey, signal) {
  let retries = 3;
  while (retries > 0) {
    if (signal?.aborted) return texts.map(()=>null);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", signal,
        headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:4096, system:SYSTEM_PROMPT,
          messages:[{role:"user",content:`ترجم هذه الجمل إلى العربية وأرجع JSON array بنفس الترتيب والعدد:\n${JSON.stringify(texts)}`}]
        })
      });
      if (resp.status===429) { await sleep(8000); retries--; continue; }
      const json = await resp.json();
      if (json.error) throw new Error(json.error.message);
      const raw = json.content?.[0]?.text||"[]";
      const parsed = JSON.parse(raw.replace(/^```json\n?/,"").replace(/\n?```$/,"").trim());
      if (Array.isArray(parsed)) return parsed;
      throw new Error("Not array");
    } catch(e) {
      if (e.name==="AbortError") return texts.map(()=>null);
      retries--;
      if (retries===0) return texts.map(()=>null);
      await sleep(2000);
    }
  }
  return texts.map(()=>null);
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ── Scan ZIP ──
async function scanZip(zip) {
  const files = [];
  const names = Object.keys(zip.files).filter(n => {
    const b = n.split("/").pop();
    return b.endsWith(".json") && !zip.files[n].dir &&
      (b.startsWith("Map") || Object.keys(CORE_PRIORITY).includes(b));
  });
  for (const name of names) {
    try {
      const text = await zip.files[name].async("text");
      const data = JSON.parse(text);
      const items = extractTexts(data, name);
      files.push({ name, base:name.split("/").pop(), data, items,
        status:"pending", // pending|translating|done|skip
        progress:0, priority:filePriority(name) });
    } catch {}
  }
  return files.sort((a,b)=>a.priority-b.priority);
}

// ── COLORS ──
const C = {
  bg:"#080d14", panel:"#0f1923", panel2:"#162030",
  border:"#1a2d42", borderBright:"#1e3a5f",
  accent:"#00d4ff", accentDim:"#0099bb",
  green:"#00ff88", greenDim:"#00cc6a",
  yellow:"#ffcc00", red:"#ff4455",
  purple:"#aa88ff", orange:"#ff8833",
  text:"#ddeeff", muted:"#4a6a8a", mutedBright:"#7a9abb",
};

const glowStyle = (color) => ({ boxShadow:`0 0 12px ${color}33` });

export default function App() {
  const zipReady = useJSZip();
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState("setup");
  const [zipObj, setZipObj] = useState(null);
  const [zipName, setZipName] = useState("");
  const [zipSize, setZipSize] = useState(0);
  const [files, setFiles] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [batchSize] = useState(25);
  const [globalProgress, setGlobalProgress] = useState({done:0,total:0,doneFiles:0,totalFiles:0});
  const [speed, setSpeed] = useState(0); // strings/min
  const [eta, setEta] = useState(null);
  const abortCtrl = useRef(null);
  const speedRef = useRef({start:0,done:0});
  const logRef = useRef(null);
  const [log, setLog] = useState([]);

  const addLog = useCallback((msg, type="info") => {
    setLog(prev=>[...prev.slice(-300), {msg,type,t:new Date().toLocaleTimeString("ar")}]);
    setTimeout(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight; },50);
  }, []);

  const updateFile = useCallback((name, patch) => {
    setFiles(prev=>prev.map(f=>f.name===name?{...f,...patch}:f));
  }, []);

  // ── Load ZIP ──
  const loadZip = async (file) => {
    if (!window.JSZip) { addLog("⏳ JSZip لا يزال يُحمَّل، انتظر لحظة","warn"); return; }
    setScanning(true); setPhase("setup"); setFiles([]); setLog([]);
    setZipName(file.name); setZipSize(file.size);
    try {
      addLog(`📦 تحليل ${file.name} — ${(file.size/1024/1024).toFixed(1)} MB`,"accent");
      const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
      setZipObj(zip);
      const scanned = await scanZip(zip);
      setFiles(scanned);
      const totalStrings = scanned.reduce((s,f)=>s+f.items.length,0);
      const withText = scanned.filter(f=>f.items.length>0);
      addLog(`✅ ${scanned.length} ملف JSON — ${withText.length} يحتوي نصاً — ${totalStrings.toLocaleString()} جملة إنجليزية`,"success");
      scanned.filter(f=>f.items.length>0).slice(0,8).forEach(f=>
        addLog(`   ${f.base}: ${f.items.length} جملة`,"muted")
      );
      if(withText.length>8) addLog(`   ... و ${withText.length-8} ملفات أخرى`,"muted");
      setGlobalProgress({done:0,total:totalStrings,doneFiles:0,totalFiles:withText.length});
      setPhase("scanned");
    } catch(e) { addLog(`❌ خطأ: ${e.message}`,"error"); }
    setScanning(false);
  };

  // ── Start translation ──
  const startTranslation = async () => {
    if (!apiKey.trim()) { addLog("❌ أدخل API Key","error"); return; }
    abortCtrl.current = new AbortController();
    setPhase("translating");
    speedRef.current = {start:Date.now(), done:0};

    const allFiles = [...files];
    let doneStrings = 0;
    let doneFiles = 0;
    const totalStrings = allFiles.reduce((s,f)=>s+f.items.length,0);
    const activeFiles = allFiles.filter(f=>f.items.length>0);

    addLog(`🚀 بدء الترجمة — ${activeFiles.length} ملف — ${totalStrings.toLocaleString()} جملة`,"accent");

    for (let fi=0; fi<allFiles.length; fi++) {
      if (abortCtrl.current?.signal.aborted) break;
      const f = allFiles[fi];

      if (f.items.length===0) {
        updateFile(f.name,{status:"skip"});
        continue;
      }

      updateFile(f.name,{status:"translating",progress:0});
      addLog(`🔄 [${doneFiles+1}/${activeFiles.length}] ${f.base} — ${f.items.length} جملة`,"info");

      const allTrans = [];
      let fileDone = 0;

      for (let i=0; i<f.items.length; i+=batchSize) {
        if (abortCtrl.current?.signal.aborted) break;
        const batch = f.items.slice(i, i+batchSize).map(x=>x.text);
        const trans = await translateBatch(batch, apiKey, abortCtrl.current.signal);
        allTrans.push(...trans);
        fileDone += batch.length;
        doneStrings += batch.length;
        speedRef.current.done = doneStrings;

        // Update speed & ETA
        const elapsed = (Date.now()-speedRef.current.start)/60000;
        const spd = elapsed>0 ? Math.round(speedRef.current.done/elapsed) : 0;
        setSpeed(spd);
        const remaining = totalStrings-doneStrings;
        setEta(spd>0 ? Math.ceil(remaining/spd) : null);

        updateFile(f.name,{progress: Math.round(fileDone/f.items.length*100)});
        setGlobalProgress({done:doneStrings,total:totalStrings,doneFiles,totalFiles:activeFiles.length});
        await sleep(150);
      }

      const newData = applyTranslations(f.data, f.items, allTrans);
      allFiles[fi] = {...f, data:newData, status:"done", progress:100};
      updateFile(f.name,{status:"done",progress:100,data:newData});
      doneFiles++;
      setGlobalProgress({done:doneStrings,total:totalStrings,doneFiles,totalFiles:activeFiles.length});
      addLog(`   ✓ ${f.base} — اكتمل`,"success");
    }

    setFiles([...allFiles]);
    setPhase("done");
    setEta(null);
    addLog(`\n🎉 اكتملت الترجمة! ${doneFiles} ملف جاهز`,"success");
  };

  // ── Export ZIP ──
  const exportZip = async () => {
    if (!zipObj) return;
    addLog("📦 تجهيز ZIP المترجم...","info");
    const newZip = new window.JSZip();
    for (const [name, file] of Object.entries(zipObj.files)) {
      if (file.dir) { newZip.folder(name); continue; }
      newZip.file(name, await file.async("arraybuffer"));
    }
    for (const f of files) {
      if (f.status==="done") newZip.file(f.name, JSON.stringify(f.data));
    }
    const blob = await newZip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=zipName.replace(".zip","_arabic.zip"); a.click();
    URL.revokeObjectURL(url);
    addLog(`✅ تم تنزيل ${a.download}`,"success");
  };

  // ── Computed ──
  const pct = globalProgress.total>0 ? Math.round(globalProgress.done/globalProgress.total*100) : 0;
  const activeFiles = files.filter(f=>f.items.length>0);
  const coreFiles = files.filter(f=>f.priority<100&&f.items.length>0);
  const mapFiles = files.filter(f=>f.priority>=100&&f.items.length>0);
  const doneCount = files.filter(f=>f.status==="done").length;

  const statusColor = s => s==="done"?C.green:s==="translating"?C.accent:s==="skip"?C.muted:C.muted;
  const statusIcon = s => s==="done"?"✓":s==="translating"?"◌":s==="skip"?"—":"○";

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Courier New',monospace",direction:"rtl",fontSize:13}}>
      {/* ═══ HEADER ═══ */}
      <div style={{background:C.panel,borderBottom:`1px solid ${C.border}`,padding:"16px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:9,color:C.accent,letterSpacing:6,marginBottom:3}}>RPG MAKER MV / MZ — ARABIC TRANSLATOR</div>
          <h1 style={{margin:0,fontSize:20,fontWeight:900,background:`linear-gradient(90deg,${C.accent},${C.green})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
            مُعرِّب الألعاب الاحترافي
          </h1>
        </div>
        {phase==="translating" && (
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:32,fontWeight:900,color:C.accent,...glowStyle(C.accent)}}>{pct}%</div>
            <div style={{fontSize:10,color:C.muted}}>
              {speed>0 && `${speed} جملة/دقيقة`}
              {eta && ` — ${eta} دقيقة متبقية`}
            </div>
          </div>
        )}
        {phase==="done" && (
          <div style={{fontSize:14,color:C.green,fontWeight:700,...glowStyle(C.green)}}>✅ اكتملت الترجمة!</div>
        )}
      </div>

      <div style={{maxWidth:1300,margin:"0 auto",padding:20,display:"grid",gridTemplateColumns:"320px 1fr",gap:18}}>
        {/* ═══ LEFT ═══ */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>

          {/* API Key */}
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
            <label style={{fontSize:9,color:C.muted,letterSpacing:3,display:"block",marginBottom:7}}>ANTHROPIC API KEY</label>
            <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-ant-api03-..."
              style={{width:"100%",background:C.bg,border:`1px solid ${apiKey?"#1e5a3a":C.border}`,borderRadius:6,padding:"9px 11px",color:C.text,fontSize:12,fontFamily:"inherit",boxSizing:"border-box",outline:"none",transition:"border-color 0.2s"}}/>
            <div style={{fontSize:9,color:C.muted,marginTop:5}}>🔒 يُرسل فقط لـ api.anthropic.com</div>
          </div>

          {/* Drop Zone */}
          <div
            onClick={()=>document.getElementById("zi").click()}
            onDrop={e=>{e.preventDefault();e.dataTransfer?.files?.[0]&&loadZip(e.dataTransfer.files[0]);}}
            onDragOver={e=>e.preventDefault()}
            style={{background:C.panel,border:`2px dashed ${zipName?C.green:C.borderBright}`,borderRadius:10,padding:22,textAlign:"center",cursor:"pointer",transition:"all 0.2s",...(zipName?glowStyle(C.green):{})}}
          >
            <input id="zi" type="file" accept=".zip" style={{display:"none"}} onChange={e=>e.target.files[0]&&loadZip(e.target.files[0])}/>
            <div style={{fontSize:36,marginBottom:8}}>{scanning?"⏳":zipName?"📦":"📂"}</div>
            {zipName ? (
              <>
                <div style={{color:C.green,fontWeight:700,fontSize:12,marginBottom:2}}>{zipName}</div>
                <div style={{color:C.muted,fontSize:10}}>{(zipSize/1024/1024).toFixed(1)} MB</div>
                {scanning && <div style={{color:C.yellow,fontSize:11,marginTop:6}}>يحلل الملفات...</div>}
              </>
            ) : (
              <>
                <div style={{color:C.accent,fontWeight:700,marginBottom:3}}>اسحب ZIP هنا أو انقر</div>
                <div style={{color:C.muted,fontSize:10}}>ZIP لمشروع RPG Maker MV/MZ كامل أو مجلد data</div>
              </>
            )}
          </div>

          {/* Stats */}
          {phase!=="setup" && (
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  {l:"ملفات أساسية",v:coreFiles.length,c:C.accent},
                  {l:"خرائط",v:mapFiles.length,c:C.purple},
                  {l:"إجمالي الجمل",v:globalProgress.total.toLocaleString(),c:C.yellow},
                  {l:"تمت ترجمته",v:`${doneCount}/${activeFiles.length}`,c:C.green},
                ].map(s=>(
                  <div key={s.l} style={{background:C.bg,borderRadius:8,padding:"10px 11px"}}>
                    <div style={{color:s.c,fontWeight:900,fontSize:18,...glowStyle(s.c)}}>{s.v}</div>
                    <div style={{color:C.muted,fontSize:9,marginTop:2}}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {phase==="scanned" && (
              <button onClick={startTranslation}
                style={{padding:"15px",background:`linear-gradient(135deg,${C.accent},${C.accentDim})`,color:"#000",border:"none",borderRadius:9,fontSize:15,fontWeight:900,cursor:"pointer",fontFamily:"inherit",...glowStyle(C.accent)}}>
                ▶ ابدأ الترجمة
              </button>
            )}
            {phase==="translating" && (
              <button onClick={()=>{abortCtrl.current?.abort();addLog("⏹ تم الإيقاف","warn");setPhase("done");}}
                style={{padding:"13px",background:C.red,color:"#fff",border:"none",borderRadius:9,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                ■ إيقاف وحفظ ما تُرجم
              </button>
            )}
            {phase==="done" && (
              <>
                <button onClick={exportZip}
                  style={{padding:"15px",background:`linear-gradient(135deg,${C.green},${C.greenDim})`,color:"#000",border:"none",borderRadius:9,fontSize:15,fontWeight:900,cursor:"pointer",fontFamily:"inherit",...glowStyle(C.green)}}>
                  ⬇ تنزيل ZIP المترجم
                </button>
                <button onClick={()=>{setPhase("setup");setFiles([]);setZipObj(null);setZipName("");setLog([]);setGlobalProgress({done:0,total:0,doneFiles:0,totalFiles:0});}}
                  style={{padding:"11px",background:C.panel,color:C.mutedBright,border:`1px solid ${C.border}`,borderRadius:9,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  🔄 مشروع جديد
                </button>
              </>
            )}
          </div>

          {/* Instructions */}
          {phase==="setup" && !scanning && (
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
              <div style={{color:C.accent,fontWeight:700,marginBottom:10,fontSize:11}}>طريقة الاستخدام</div>
              {[
                ["1","API Key من console.anthropic.com",C.accent],
                ["2","ارفع ZIP مشروع RPG Maker MV/MZ",C.purple],
                ["3","شاهد تحليل الملفات والإحصائيات",C.yellow],
                ["4","ابدأ الترجمة — كل ملف يظهر تقدمه",C.orange],
                ["5","نزّل ZIP مترجم كامل جاهز للتشغيل",C.green],
              ].map(([n,t,c])=>(
                <div key={n} style={{display:"flex",gap:8,marginBottom:7,fontSize:11,color:C.mutedBright,alignItems:"flex-start"}}>
                  <span style={{color:c,fontWeight:900,flexShrink:0}}>{n}.</span><span>{t}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ RIGHT ═══ */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>

          {/* Global progress bar */}
          {(phase==="translating"||phase==="done") && (
            <div style={{background:C.panel,border:`1px solid ${phase==="done"?C.green:C.border}`,borderRadius:10,padding:16,...(phase==="done"?glowStyle(C.green):{})}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <span style={{fontWeight:700,color:phase==="done"?C.green:C.text}}>
                  {phase==="done"?"✅ اكتمل":"⏳ جاري الترجمة"}
                </span>
                <span style={{color:C.muted,fontSize:11}}>
                  {globalProgress.done.toLocaleString()} / {globalProgress.total.toLocaleString()} جملة
                  &nbsp;—&nbsp;{globalProgress.doneFiles}/{globalProgress.totalFiles} ملف
                </span>
              </div>
              <div style={{background:C.border,borderRadius:6,height:14,overflow:"hidden",position:"relative"}}>
                <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${C.accent},${C.green})`,transition:"width 0.5s",borderRadius:6,...glowStyle(C.accent)}}/>
                <div style={{position:"absolute",top:0,left:0,right:0,bottom:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#000",mixBlendMode:"difference"}}>
                  {pct}%
                </div>
              </div>
              {speed>0 && (
                <div style={{marginTop:8,fontSize:10,color:C.muted,display:"flex",gap:16}}>
                  <span>⚡ {speed} جملة/دقيقة</span>
                  {eta && <span>⏱ {eta} دقيقة متبقية تقريباً</span>}
                </div>
              )}
            </div>
          )}

          {/* Per-file list */}
          {files.length>0 && (
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
              <div style={{fontSize:9,color:C.muted,letterSpacing:3,marginBottom:10}}>تقدم كل ملف</div>
              <div style={{maxHeight:340,overflowY:"auto",display:"flex",flexDirection:"column",gap:4,paddingLeft:4}}>
                {files.filter(f=>f.items.length>0).map(f=>(
                  <div key={f.name} style={{background:C.bg,borderRadius:7,padding:"8px 10px",border:`1px solid ${f.status==="translating"?C.accent:f.status==="done"?C.green+"44":C.border}`,transition:"border-color 0.3s",...(f.status==="translating"?glowStyle(C.accent):{})}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:f.status==="translating"?5:0}}>
                      <span style={{color:statusColor(f.status),fontWeight:900,fontSize:14,flexShrink:0,animation:f.status==="translating"?"spin 1s linear infinite":undefined}}>
                        {statusIcon(f.status)}
                      </span>
                      <span style={{flex:1,fontSize:11,color:f.status==="done"?C.green:f.status==="translating"?C.accent:C.mutedBright,fontWeight:f.status==="translating"?700:400}}>
                        {f.base}
                      </span>
                      <span style={{fontSize:10,color:C.muted}}>{f.items.length} جملة</span>
                      {f.priority<100 && <span style={{fontSize:8,background:C.accent+"22",color:C.accent,padding:"1px 5px",borderRadius:3,flexShrink:0}}>أساسي</span>}
                      {f.status==="done" && <span style={{fontSize:10,color:C.green,fontWeight:700}}>✓</span>}
                      {f.status==="translating" && <span style={{fontSize:10,color:C.accent,fontWeight:700}}>{f.progress}%</span>}
                    </div>
                    {f.status==="translating" && (
                      <div style={{background:C.border,borderRadius:4,height:4,overflow:"hidden"}}>
                        <div style={{width:`${f.progress}%`,height:"100%",background:`linear-gradient(90deg,${C.accent},${C.green})`,transition:"width 0.4s",borderRadius:4}}/>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Log */}
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:14,flex:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:9,color:C.muted,letterSpacing:3}}>سجل العمليات</div>
              {log.length>0&&<button onClick={()=>setLog([])} style={{fontSize:9,color:C.muted,background:"none",border:"none",cursor:"pointer"}}>مسح</button>}
            </div>
            <div ref={logRef} style={{maxHeight:280,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
              {log.length===0 ? (
                <div style={{color:C.muted,fontSize:11,textAlign:"center",paddingTop:25}}>
                  {zipReady?"ارفع ملف ZIP للبدء...":"⏳ تحميل مكتبة JSZip..."}
                </div>
              ) : log.map((e,i)=>(
                <div key={i} style={{display:"flex",gap:8,fontSize:10,padding:"2px 6px",borderRadius:3,background:i===log.length-1?C.panel2:"transparent"}}>
                  <span style={{color:C.muted,flexShrink:0,fontSize:9}}>{e.t}</span>
                  <span style={{color:e.type==="error"?C.red:e.type==="success"?C.green:e.type==="warn"?C.yellow:e.type==="accent"?C.accent:e.type==="muted"?C.muted:C.mutedBright}}>
                    {e.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
        input::placeholder{color:${C.muted}}
      `}</style>
    </div>
  );
}
